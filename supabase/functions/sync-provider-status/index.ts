import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-datahub-signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DATAHUB_BASE = 'https://user.datahubgh.com/api/external'
const SKPLUG_BASE = 'https://skdataplug.com/api/v1'

type OrderRow = {
  id: string
  reference: string
  status: string
  provider_reference: string | null
  provider_order_number: string | null
  provider_status: string | null
  provider_type: string | null
  provider_name: string | null
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function mapProviderStatus(raw: string): { providerStatus: string; orderStatus: string | null } {
  const s = raw.toLowerCase().trim()
  if (['delivered', 'completed', 'success', 'successful'].includes(s)) {
    return { providerStatus: 'delivered', orderStatus: 'completed' }
  }
  if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(s)) {
    return { providerStatus: 'failed', orderStatus: 'failed' }
  }
  if (['processing', 'in_progress', 'in-progress', 'pending', 'submitted'].includes(s)) {
    return {
      providerStatus: s === 'pending' ? 'pending' : s === 'submitted' ? 'submitted' : 'processing',
      orderStatus: 'processing',
    }
  }
  return { providerStatus: raw, orderStatus: null }
}

async function fetchDatahubStatus(apiKey: string, reference: string | null, orderNumber: string | null) {
  const tryParse = (body: Record<string, unknown>) => {
    if (body?.success && body?.data) {
      const data = body.data as Record<string, unknown>
      const status = String(data.status ?? data.orderStatus ?? body.status ?? '')
      if (status) return { ok: true, status, body }
    }
    if (body?.status) return { ok: true, status: String(body.status), body }
    return null
  }

  const refs = [...new Set([reference, orderNumber].filter(Boolean))] as string[]

  for (const ref of refs) {
    const getUrl = `${DATAHUB_BASE}/order-status?reference=${encodeURIComponent(ref)}`
    const getRes = await fetch(getUrl, { headers: { 'X-API-Key': apiKey } })
    const getBody = await getRes.json().catch(() => ({}))
    const parsed = tryParse(getBody as Record<string, unknown>)
    if (parsed) return parsed
    if (getBody?.success === false && !/not found/i.test(String(getBody.error ?? ''))) {
      break
    }

    const postRes = await fetch(`${DATAHUB_BASE}/order-status`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: ref }),
    })
    const postBody = await postRes.json().catch(() => ({}))
    const postParsed = tryParse(postBody as Record<string, unknown>)
    if (postParsed) return postParsed
  }

  return { ok: false, status: null, body: { error: 'Status not found' } }
}

async function fetchSkplugStatus(token: string, orderId: string) {
  const id = orderId.trim()
  const res = await fetch(`${SKPLUG_BASE}/status/${encodeURIComponent(id)}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await res.json().catch(() => ({}))
  const status = body?.status ?? body?.data?.status
  if (status) return { ok: true, status: String(status), body }
  return { ok: false, status: null, body }
}

function resolveProviderType(order: OrderRow): 'datahub' | 'skplug' {
  if (order.provider_type === 'skplug' || order.provider_type === 'datahub') {
    return order.provider_type
  }
  if (order.provider_name?.toLowerCase().includes('sk plug')) return 'skplug'
  return 'datahub'
}

async function syncOrderStatus(
  supabase: ReturnType<typeof createClient>,
  order: OrderRow,
  datahubKey: string,
  skplugToken: string,
) {
  const providerType = resolveProviderType(order)
  let result: { ok: boolean; status: string | null; body: unknown }

  if (providerType === 'skplug') {
    const orderId = order.provider_order_number ?? order.provider_reference ?? order.reference
    if (!skplugToken) {
      return { order_id: order.id, skipped: true, reason: 'No SK Plug token' }
    }
    result = await fetchSkplugStatus(skplugToken, orderId)
  } else {
    if (!datahubKey) {
      return { order_id: order.id, skipped: true, reason: 'No Datahub key' }
    }
    result = await fetchDatahubStatus(
      datahubKey,
      order.provider_reference ?? order.reference,
      order.provider_order_number,
    )
  }

  if (!result.ok || !result.status) {
    return {
      order_id: order.id,
      reference: order.reference,
      success: false,
      unchanged: true,
      provider_type: providerType,
      error: (result.body as Record<string, unknown>)?.error ?? 'No status returned',
    }
  }

  const mapped = mapProviderStatus(result.status)
  const update: Record<string, unknown> = {
    provider_status: mapped.providerStatus,
    updated_at: new Date().toISOString(),
  }

  if (mapped.orderStatus && mapped.orderStatus !== order.status) {
    update.status = mapped.orderStatus
    if (mapped.orderStatus === 'completed') {
      update.completed_at = new Date().toISOString()
    }
    if (mapped.orderStatus === 'failed') {
      update.failure_reason = `Provider reported: ${result.status}`
    }
  }

  await supabase.from('orders').update(update).eq('id', order.id)

  return {
    order_id: order.id,
    reference: order.reference,
    success: true,
    provider_type: providerType,
    provider_status: mapped.providerStatus,
    order_status: update.status ?? order.status,
    raw_status: result.status,
  }
}

function extractWebhookPayload(body: Record<string, unknown>) {
  const reference =
    body.reference ??
    body.orderReference ??
    (body.data as Record<string, unknown> | undefined)?.reference ??
    (body.order as Record<string, unknown> | undefined)?.reference
  const orderNumber =
    body.orderNumber ??
    body.orderNo ??
    (body.data as Record<string, unknown> | undefined)?.orderNumber
  const status =
    body.status ??
    (body.data as Record<string, unknown> | undefined)?.status ??
    (body.order as Record<string, unknown> | undefined)?.status

  return {
    reference: reference ? String(reference) : null,
    orderNumber: orderNumber ? String(orderNumber) : null,
    status: status ? String(status) : null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const url = new URL(req.url)
  let path = url.pathname
  const idx = path.indexOf('/sync-provider-status')
  if (idx >= 0) path = path.slice(idx + '/sync-provider-status'.length) || '/'

  const webhookIdx = path.indexOf('/provider-webhook')
  const isWebhook = webhookIdx >= 0 || path.includes('/datahub')

  try {
    if (isWebhook && req.method === 'POST') {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const { reference, orderNumber, status } = extractWebhookPayload(body)

      if (!status) {
        return json({ success: false, error: 'Missing status in webhook payload' }, 400)
      }

      let query = supabase.from('orders').select('*')
      if (reference) {
        query = query.or(`reference.eq.${reference},provider_reference.eq.${reference}`)
      } else if (orderNumber) {
        query = query.eq('provider_order_number', orderNumber)
      } else {
        return json({ success: false, error: 'Missing reference or orderNumber' }, 400)
      }

      const { data: order } = await query.maybeSingle()
      if (!order) {
        return json({ success: true, message: 'Order not found locally', reference, orderNumber })
      }

      const mapped = mapProviderStatus(status)
      const update: Record<string, unknown> = {
        provider_status: mapped.providerStatus,
        updated_at: new Date().toISOString(),
      }
      if (mapped.orderStatus) {
        update.status = mapped.orderStatus
        if (mapped.orderStatus === 'completed') update.completed_at = new Date().toISOString()
        if (mapped.orderStatus === 'failed') update.failure_reason = `Provider webhook: ${status}`
      }

      await supabase.from('orders').update(update).eq('id', order.id)
      return json({ success: true, order_id: order.id, status: mapped.orderStatus ?? order.status })
    }

    if (req.method === 'POST' && (path === '/process' || path === '/')) {
      const { data: settings } = await supabase.from('site_settings').select('key, value')
      const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))

      if (settingsMap.provider_status_sync_enabled === 'false') {
        return json({ success: true, processed: 0, message: 'Provider status sync disabled' })
      }

      const datahubKey =
        settingsMap.data_provider_primary_type !== 'skplug'
          ? settingsMap.data_provider_primary_api_key?.trim()
          : settingsMap.data_provider_secondary_type === 'datahub'
            ? settingsMap.data_provider_secondary_api_key?.trim()
            : ''
      const skplugToken =
        settingsMap.data_provider_secondary_type === 'skplug'
          ? settingsMap.data_provider_secondary_api_key?.trim()
          : settingsMap.data_provider_primary_type === 'skplug'
            ? settingsMap.data_provider_primary_api_key?.trim()
            : ''

      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100)
      const { data: orders, error } = await supabase.rpc('get_orders_pending_provider_status', {
        p_limit: limit,
      })

      if (error) {
        return json({ success: false, error: error.message }, 500)
      }

      const results = []
      for (const order of (orders as OrderRow[]) ?? []) {
        results.push(await syncOrderStatus(supabase, order, datahubKey ?? '', skplugToken ?? ''))
      }

      return json({
        success: true,
        processed: results.length,
        updated: results.filter((r) => r.success && !r.unchanged).length,
        results,
      })
    }

    if (req.method === 'GET' && path === '/health') {
      return json({ success: true, service: 'sync-provider-status' })
    }

    return json({
      success: true,
      endpoints: {
        'POST /process': 'Poll provider APIs and update order statuses',
        'POST /provider-webhook/datahub': 'Receive Datahub webhook callbacks',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
