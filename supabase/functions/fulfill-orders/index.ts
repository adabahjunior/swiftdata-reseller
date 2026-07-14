import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DATAHUB_BASE = 'https://user.datahubgh.com/api/external'
const SKPLUG_BASE = 'https://skdataplug.com/api/v1'

/** Our DB network → Datahub networkKey */
const DATAHUB_NETWORK_MAP: Record<string, string> = {
  mtn: 'YELLO',
  at_ishare: 'AT_PREMIUM',
  at_bigtime: 'AT_BIGTIME',
  telecel: 'TELECEL',
}

/** Our DB network → SK Plug network */
const SKPLUG_NETWORK_MAP: Record<string, string> = {
  mtn: 'MTN',
  at_ishare: 'AT_EXPIRY',
  at_bigtime: 'AT_NOEXPIRY',
  telecel: 'TELECEL',
}

type OrderRow = {
  id: string
  reference: string
  phone: string
  network: string
  size_gb: number
  status: string
  provider_submitted_at: string | null
}

type ProviderSlug = 'primary' | 'secondary'
type ProviderType = 'datahub' | 'skplug'

type ActiveProvider = {
  slug: ProviderSlug
  type: ProviderType
  name: string
  apiKey: string
}

type PurchaseResult = {
  success: boolean
  providerRef: string | null
  providerOrderNo: string | null
  error: string | null
  raw: Record<string, unknown>
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getActiveProvider(
  settingsMap: Record<string, string>,
  envFallback?: string | null,
): ActiveProvider {
  const slug: ProviderSlug =
    settingsMap.active_data_provider === 'secondary' ? 'secondary' : 'primary'

  const primaryKey =
    settingsMap.data_provider_primary_api_key?.trim() || envFallback?.trim() || ''
  const secondaryKey = settingsMap.data_provider_secondary_api_key?.trim() || ''

  if (slug === 'secondary') {
    const type = (settingsMap.data_provider_secondary_type?.trim() || 'skplug') as ProviderType
    return {
      slug,
      type: type === 'datahub' ? 'datahub' : 'skplug',
      name: settingsMap.data_provider_secondary_name?.trim() || 'SK Plug',
      apiKey: secondaryKey,
    }
  }

  const type = (settingsMap.data_provider_primary_type?.trim() || 'datahub') as ProviderType
  return {
    slug,
    type: type === 'skplug' ? 'skplug' : 'datahub',
    name: settingsMap.data_provider_primary_name?.trim() || 'Primary Datahub',
    apiKey: primaryKey,
  }
}

async function datahubPurchase(
  apiKey: string,
  payload: { networkKey: string; recipient: string; capacity: number; reference: string },
): Promise<PurchaseResult> {
  const res = await fetch(`${DATAHUB_BASE}/data-purchase`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  const success = Boolean(body?.success)
  return {
    success,
    providerRef: body?.data?.reference ?? body?.reference ?? body?.data?.orderReference ?? null,
    providerOrderNo:
      body?.data?.orderNumber ?? body?.orderNumber ?? body?.data?.orderNo ?? null,
    error: success ? null : String(body?.error ?? body?.message ?? 'Datahub rejected order'),
    raw: body as Record<string, unknown>,
  }
}

async function skplugPurchase(
  token: string,
  payload: { recipient: string; network: string; gb_size: string },
): Promise<PurchaseResult> {
  const res = await fetch(`${SKPLUG_BASE}/order/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  const orderId =
    body?.order_id ?? body?.orderId ?? body?.data?.order_id ?? body?.id ?? null
  const status = String(body?.status ?? body?.data?.status ?? '').toLowerCase()
  const success =
    res.ok &&
    Boolean(orderId) &&
    status !== 'failed' &&
    !body?.error &&
    body?.success !== false

  return {
    success,
    providerRef: orderId ? String(orderId) : null,
    providerOrderNo: orderId ? String(orderId) : null,
    error: success
      ? null
      : String(body?.error ?? body?.message ?? body?.detail ?? `SK Plug rejected order (${res.status})`),
    raw: body as Record<string, unknown>,
  }
}

async function purchaseWithProvider(
  provider: ActiveProvider,
  order: OrderRow,
  mtnNetworkKey: string,
): Promise<PurchaseResult> {
  if (provider.type === 'skplug') {
    const network = SKPLUG_NETWORK_MAP[order.network] ?? order.network.toUpperCase()
    return skplugPurchase(provider.apiKey, {
      recipient: order.phone,
      network,
      gb_size: String(Number(order.size_gb)),
    })
  }

  const networkKey =
    order.network === 'mtn'
      ? mtnNetworkKey
      : DATAHUB_NETWORK_MAP[order.network] ?? order.network.toUpperCase()

  return datahubPurchase(provider.apiKey, {
    networkKey,
    recipient: order.phone,
    capacity: Number(order.size_gb),
    reference: order.reference,
  })
}

async function providerHealth(provider: ActiveProvider) {
  if (provider.type === 'skplug') {
    const res = await fetch(`${SKPLUG_BASE}/bundles/`, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
    })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, body }
  }

  const res = await fetch(`${DATAHUB_BASE}/balance`, {
    headers: { 'X-API-Key': provider.apiKey },
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, body }
}

async function fulfillOrder(
  supabase: ReturnType<typeof createClient>,
  provider: ActiveProvider,
  order: OrderRow,
  mtnNetworkKey: string,
) {
  if (order.provider_submitted_at) {
    return { order_id: order.id, skipped: true, reason: 'Already submitted' }
  }

  if (!provider.apiKey) {
    const update = {
      provider_submitted_at: new Date().toISOString(),
      provider_status: 'failed',
      provider_name: provider.name,
      provider_error: `No API credential configured for ${provider.slug} provider`,
    }
    await supabase.from('orders').update(update).eq('id', order.id)
    return {
      order_id: order.id,
      reference: order.reference,
      success: false,
      provider_status: update.provider_status,
      provider_name: provider.name,
      provider_type: provider.type,
      error: update.provider_error,
    }
  }

  const result = await purchaseWithProvider(provider, order, mtnNetworkKey)

  const update = {
    provider_submitted_at: new Date().toISOString(),
    provider_status: result.success ? 'submitted' : 'failed',
    provider_name: provider.name,
    provider_reference: result.providerRef,
    provider_order_number: result.providerOrderNo,
    provider_error: result.error,
    status: result.success && order.status === 'pending' ? 'processing' : order.status,
  }

  await supabase.from('orders').update(update).eq('id', order.id)

  return {
    order_id: order.id,
    reference: order.reference,
    success: result.success,
    provider_status: update.provider_status,
    provider_name: provider.name,
    provider_type: provider.type,
    error: result.error,
    provider_reference: result.providerRef,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const envFallback = Deno.env.get('DATAHUB_API_KEY')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const url = new URL(req.url)
  let path = url.pathname
  const idx = path.indexOf('/fulfill-orders')
  if (idx >= 0) path = path.slice(idx + '/fulfill-orders'.length) || '/'

  try {
    if (req.method === 'POST' && path === '/process') {
      const { data: settings } = await supabase.from('site_settings').select('key, value')
      const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))

      if (settingsMap.provider_fulfillment_enabled === 'false') {
        return json({ success: true, processed: 0, message: 'Provider fulfillment disabled' })
      }

      const provider = getActiveProvider(settingsMap, envFallback)
      if (!provider.apiKey) {
        return json({
          success: false,
          error: `No API credential configured for active ${provider.slug} provider`,
        }, 500)
      }

      const mtnKey = settingsMap.provider_mtn_network_key || 'YELLO'
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100)

      const { data: orders, error } = await supabase.rpc('get_orders_pending_provider', {
        p_limit: limit,
      })

      if (error) {
        return json({ success: false, error: error.message }, 500)
      }

      const results = []
      for (const order of (orders as OrderRow[]) ?? []) {
        results.push(await fulfillOrder(supabase, provider, order, mtnKey))
      }

      return json({
        success: true,
        active_provider: provider.slug,
        provider_name: provider.name,
        provider_type: provider.type,
        processed: results.length,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => r.success === false).length,
        results,
      })
    }

    if (req.method === 'POST' && path.startsWith('/order/')) {
      const orderId = path.replace('/order/', '').trim()
      if (!orderId) {
        return json({ success: false, error: 'Order id required' }, 400)
      }

      const { data: settings } = await supabase.from('site_settings').select('key, value')
      const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))
      const provider = getActiveProvider(settingsMap, envFallback)

      if (!provider.apiKey) {
        return json({
          success: false,
          error: `No API credential configured for active ${provider.slug} provider`,
        }, 500)
      }

      const mtnKey = settingsMap.provider_mtn_network_key || 'YELLO'

      const { data: order, error } = await supabase
        .from('orders')
        .select('id, reference, phone, network, size_gb, status, provider_submitted_at')
        .eq('id', orderId)
        .maybeSingle()

      if (error || !order) {
        return json({ success: false, error: 'Order not found' }, 404)
      }

      const result = await fulfillOrder(supabase, provider, order as OrderRow, mtnKey)
      return json({
        success: true,
        active_provider: provider.slug,
        provider_name: provider.name,
        provider_type: provider.type,
        result,
      })
    }

    if (req.method === 'GET' && path === '/health') {
      const { data: settings } = await supabase.from('site_settings').select('key, value')
      const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))
      const provider = getActiveProvider(settingsMap, envFallback)

      if (!provider.apiKey) {
        return json({
          success: false,
          error: `No API credential configured for active ${provider.slug} provider`,
        }, 500)
      }

      const health = await providerHealth(provider)
      return json({
        success: health.ok,
        active_provider: provider.slug,
        provider_name: provider.name,
        provider_type: provider.type,
        upstream: health.body,
      })
    }

    return json({
      success: true,
      endpoints: {
        'POST /process': 'Submit pending orders to the active provider (Datahub or SK Plug)',
        'POST /order/{id}': 'Submit one order to the active provider',
        'GET /health': 'Check active provider connection',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
