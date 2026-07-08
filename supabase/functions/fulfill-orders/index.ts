import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DATAHUB_BASE = 'https://user.datahubgh.com/api/external'

const NETWORK_MAP: Record<string, string> = {
  mtn: 'YELLO',
  at_ishare: 'AT_PREMIUM',
  at_bigtime: 'AT_BIGTIME',
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function datahubPurchase(
  apiKey: string,
  payload: { networkKey: string; recipient: string; capacity: number; reference: string },
) {
  const res = await fetch(`${DATAHUB_BASE}/data-purchase`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

async function fulfillOrder(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  order: OrderRow,
  mtnNetworkKey: string,
) {
  if (order.provider_submitted_at) {
    return { order_id: order.id, skipped: true, reason: 'Already submitted' }
  }

  const networkKey =
    order.network === 'mtn'
      ? mtnNetworkKey
      : NETWORK_MAP[order.network] ?? order.network.toUpperCase()

  const { body } = await datahubPurchase(apiKey, {
    networkKey,
    recipient: order.phone,
    capacity: Number(order.size_gb),
    reference: order.reference,
  })

  const success = Boolean(body?.success)
  const providerRef =
    body?.data?.reference ?? body?.reference ?? body?.data?.orderReference ?? null
  const providerOrderNo =
    body?.data?.orderNumber ?? body?.orderNumber ?? body?.data?.orderNo ?? null

  const update = {
    provider_submitted_at: new Date().toISOString(),
    provider_status: success ? 'submitted' : 'failed',
    provider_reference: providerRef,
    provider_order_number: providerOrderNo ? String(providerOrderNo) : null,
    provider_error: success ? null : String(body?.error ?? body?.message ?? 'Provider rejected order'),
    status: success && order.status === 'pending' ? 'processing' : order.status,
  }

  await supabase.from('orders').update(update).eq('id', order.id)

  return {
    order_id: order.id,
    reference: order.reference,
    success,
    provider_status: update.provider_status,
    error: update.provider_error,
    provider_reference: providerRef,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const apiKey = Deno.env.get('DATAHUB_API_KEY')
  if (!apiKey) {
    return json({ success: false, error: 'DATAHUB_API_KEY not configured on server' }, 500)
  }

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
        results.push(await fulfillOrder(supabase, apiKey, order, mtnKey))
      }

      return json({
        success: true,
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
      const mtnKey = settingsMap.provider_mtn_network_key || 'YELLO'

      const { data: order, error } = await supabase
        .from('orders')
        .select('id, reference, phone, network, size_gb, status, provider_submitted_at')
        .eq('id', orderId)
        .maybeSingle()

      if (error || !order) {
        return json({ success: false, error: 'Order not found' }, 404)
      }

      const result = await fulfillOrder(supabase, apiKey, order as OrderRow, mtnKey)
      return json({ success: true, result })
    }

    if (req.method === 'GET' && path === '/health') {
      const res = await fetch(`${DATAHUB_BASE}/balance`, {
        headers: { 'X-API-Key': apiKey },
      })
      const body = await res.json()
      return json({ success: res.ok, datahub: body })
    }

    return json({
      success: true,
      endpoints: {
        'POST /process': 'Submit all pending orders to Datahub',
        'POST /order/{id}': 'Submit one order to Datahub',
        'GET /health': 'Check Datahub provider connection',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
