import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const SKPLUG_BASE = 'https://skdataplug.com/api/v1'

type SkplugRawOrder = {
  order_id?: string
  network?: string
  recipient?: string
  gb_size?: string | number
  price_paid?: string | number
  amount_owed?: string | number
  status?: string
  created_at?: string
  paid?: boolean
  [key: string]: unknown
}

type SkplugBucket = {
  count?: number
  total?: string | number
  orders?: SkplugRawOrder[]
}

type LocalOrder = {
  id: string
  user_id: string
  reference: string
  phone: string
  network: string
  size_gb: number
  amount: number
  status: string
  order_source: string | null
  provider_order_number: string | null
  provider_reference: string | null
  provider_status: string | null
  provider_error: string | null
  created_at: string
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function settingsMap(rows: Array<{ key: string; value: string }>) {
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']))
}

function getSkplugToken(settings: Record<string, string>) {
  if ((settings.data_provider_primary_type || 'datahub') === 'skplug') {
    return {
      token: settings.data_provider_primary_api_key?.trim() || '',
      name: settings.data_provider_primary_name?.trim() || 'SK Plug',
    }
  }
  if ((settings.data_provider_secondary_type || 'skplug') === 'skplug') {
    return {
      token: settings.data_provider_secondary_api_key?.trim() || '',
      name: settings.data_provider_secondary_name?.trim() || 'SK Plug',
    }
  }
  // Fall back to whichever key looks configured
  const secondary = settings.data_provider_secondary_api_key?.trim() || ''
  const primary = settings.data_provider_primary_api_key?.trim() || ''
  return {
    token: secondary || primary,
    name: secondary
      ? settings.data_provider_secondary_name?.trim() || 'SK Plug'
      : settings.data_provider_primary_name?.trim() || 'SK Plug',
  }
}

function normalizeBucket(raw: SkplugBucket | undefined, bucketStatus: string) {
  const orders = Array.isArray(raw?.orders) ? raw!.orders! : []
  const total = Number(raw?.total ?? 0)
  return {
    count: Number(raw?.count ?? orders.length),
    total: Number.isFinite(total) ? total : 0,
    orders: orders.map((o) => ({
      order_id: String(o.order_id ?? ''),
      network: String(o.network ?? ''),
      recipient: String(o.recipient ?? ''),
      gb_size: Number(o.gb_size ?? 0),
      price_paid: Number(o.price_paid ?? 0),
      amount_owed: Number(o.amount_owed ?? o.price_paid ?? 0),
      status: String(o.status ?? bucketStatus),
      created_at: o.created_at ? String(o.created_at) : null,
      paid: typeof o.paid === 'boolean' ? o.paid : null,
    })),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ success: false, error: 'Missing Authorization bearer token' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const adminClient = createClient(supabaseUrl, serviceKey)

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) {
    return json({ success: false, error: 'Invalid or expired session' }, 401)
  }

  const userId = userData.user.id
  const { data: profile } = await adminClient
    .from('profiles')
    .select('id, is_admin, full_name, email')
    .eq('id', userId)
    .maybeSingle()

  const isAdmin = Boolean(profile?.is_admin)

  const { data: settingsRows } = await adminClient.from('site_settings').select('key, value')
  const settings = settingsMap((settingsRows ?? []) as Array<{ key: string; value: string }>)
  const { token, name: providerName } = getSkplugToken(settings)

  if (!token) {
    return json({ success: false, error: 'SK Plug API token is not configured' }, 503)
  }

  let summaryRaw: Record<string, unknown>
  try {
    const res = await fetch(`${SKPLUG_BASE}/orders-summary/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    summaryRaw = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return json(
        {
          success: false,
          error: String(
            summaryRaw.error ??
              summaryRaw.message ??
              summaryRaw.detail ??
              `SK Plug orders-summary failed (${res.status})`,
          ),
        },
        res.status >= 400 ? res.status : 502,
      )
    }
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 502)
  }

  const waiting = normalizeBucket(summaryRaw.waiting as SkplugBucket | undefined, 'waiting')
  const refunded = normalizeBucket(summaryRaw.refunded as SkplugBucket | undefined, 'refunded')
  const refundRequested = normalizeBucket(
    summaryRaw.refund_requested as SkplugBucket | undefined,
    'refund_requested',
  )

  const allSkOrders = [...waiting.orders, ...refunded.orders, ...refundRequested.orders]
  const skIds = [...new Set(allSkOrders.map((o) => o.order_id).filter(Boolean))]

  let localOrders: LocalOrder[] = []
  if (skIds.length > 0) {
    const { data } = await adminClient
      .from('orders')
      .select(
        'id, user_id, reference, phone, network, size_gb, amount, status, order_source, provider_order_number, provider_reference, provider_status, provider_error, created_at',
      )
      .or(
        [
          `provider_order_number.in.(${skIds.map((id) => `"${id}"`).join(',')})`,
          `provider_reference.in.(${skIds.map((id) => `"${id}"`).join(',')})`,
        ].join(','),
      )
    localOrders = (data ?? []) as LocalOrder[]
  }

  const localByProviderId = new Map<string, LocalOrder>()
  for (const order of localOrders) {
    if (order.provider_order_number) localByProviderId.set(order.provider_order_number, order)
    if (order.provider_reference) localByProviderId.set(order.provider_reference, order)
  }

  // Fallback match by recipient phone + gb size when provider id missing on our side
  const phones = [...new Set(allSkOrders.map((o) => o.recipient).filter(Boolean))]
  let phoneOrders: LocalOrder[] = []
  if (phones.length > 0) {
    const { data } = await adminClient
      .from('orders')
      .select(
        'id, user_id, reference, phone, network, size_gb, amount, status, order_source, provider_order_number, provider_reference, provider_status, provider_error, created_at',
      )
      .in('phone', phones)
      .eq('provider_type', 'skplug')
      .limit(500)
    phoneOrders = (data ?? []) as LocalOrder[]
  }

  function findLocal(sk: {
    order_id: string
    recipient: string
    gb_size: number
  }): LocalOrder | null {
    if (sk.order_id && localByProviderId.has(sk.order_id)) {
      return localByProviderId.get(sk.order_id)!
    }
    const candidates = phoneOrders.filter(
      (o) =>
        o.phone === sk.recipient &&
        Number(o.size_gb) === Number(sk.gb_size),
    )
    if (candidates.length === 1) return candidates[0]
    return null
  }

  type ProfileLite = { id: string; full_name: string | null; email: string | null }
  const userIds = [
    ...new Set([...localOrders, ...phoneOrders].map((o) => o.user_id)),
  ]
  const profileMap = new Map<string, ProfileLite>()
  if (isAdmin && userIds.length > 0) {
    const { data: profiles } = await adminClient
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const p of (profiles ?? []) as ProfileLite[]) profileMap.set(p.id, p)
  }

  function enrich(bucket: ReturnType<typeof normalizeBucket>, bucketKey: string) {
    const enriched = bucket.orders
      .map((sk) => {
        const local = findLocal(sk)
        if (!isAdmin) {
          if (!local || local.user_id !== userId) return null
        }
        return {
          ...sk,
          bucket: bucketKey,
          local_order: local
            ? {
                id: local.id,
                reference: local.reference,
                user_id: local.user_id,
                status: local.status,
                amount: Number(local.amount),
                order_source: local.order_source,
                provider_status: local.provider_status,
                provider_error: local.provider_error,
                created_at: local.created_at,
                user: isAdmin ? profileMap.get(local.user_id) ?? null : null,
              }
            : null,
        }
      })
      .filter(Boolean)

    const total = enriched.reduce((sum, o) => sum + Number((o as { amount_owed: number }).amount_owed || 0), 0)
    return {
      count: enriched.length,
      total: Math.round(total * 100) / 100,
      orders: enriched,
    }
  }

  const waitingOut = enrich(waiting, 'waiting')
  const refundedOut = enrich(refunded, 'refunded')
  const refundRequestedOut = enrich(refundRequested, 'refund_requested')

  return json({
    success: true,
    provider: providerName,
    scope: isAdmin ? 'admin' : 'user',
    fetched_at: new Date().toISOString(),
    waiting: waitingOut,
    refunded: refundedOut,
    refund_requested: refundRequestedOut,
    totals: {
      count: waitingOut.count + refundedOut.count + refundRequestedOut.count,
      amount_owed:
        Math.round((waitingOut.total + refundedOut.total + refundRequestedOut.total) * 100) / 100,
    },
  })
})
