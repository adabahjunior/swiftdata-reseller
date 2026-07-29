import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

type OrderRow = {
  id: string
  reference: string
  phone: string
  network: string
  amount: number
  face_amount: number | null
  service_type: string
  utility_product_id: string | null
  utility_meta: Record<string, unknown> | null
  status: string
  provider_submitted_at: string | null
}

type UtilityProduct = {
  id: string
  service_type: string
  provider_code: string
  label: string
  xcel_merchant_id: string | null
  xcel_to_acct: string | null
  xcel_biller_wallet_num: string | null
  xcel_account_name: string | null
  bill_sub_type: string | null
  xcel_type: string | null
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

async function hmacSha256Hex(secret: string, message: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function requestDlCode(
  base: string,
  path: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ dl_code?: string; secret?: string; raw: Record<string, unknown> }> {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const data = (raw.data as Record<string, unknown> | undefined) ?? raw
  return {
    dl_code: String(data.dl_code ?? data.dlCode ?? raw.dl_code ?? ''),
    secret: data.secret ? String(data.secret) : undefined,
    raw,
  }
}

async function fulfillOne(
  supabase: ReturnType<typeof createClient>,
  order: OrderRow,
  settings: Record<string, string>,
  product: UtilityProduct | null,
) {
  const claimedAt = new Date().toISOString()
  const { data: claimed } = await supabase
    .from('orders')
    .update({
      provider_submitted_at: claimedAt,
      provider_name: 'Xcel',
      provider_type: 'xcel',
      provider_status: 'submitting',
      provider_error: null,
      status: order.status === 'pending' ? 'processing' : order.status,
    })
    .eq('id', order.id)
    .is('provider_submitted_at', null)
    .select('id')
    .maybeSingle()

  if (!claimed) {
    return { id: order.id, skipped: true, reason: 'already_claimed' }
  }

  const base = (settings.xcel_api_base || 'https://api.xcelapp.com').trim()
  const buyPath = (settings.xcel_buy_path || '/partners/utilities/buy').trim()
  const dlPath = (settings.xcel_dl_code_path || '/partners/momo/dl-code').trim()
  const userId = (settings.xcel_user_id || '').trim()
  const pin = (settings.xcel_pin || '').trim()
  const fromAcct = (settings.xcel_from_acct || '').trim()
  const hmacSecret = (settings.xcel_hmac_secret || '').trim()
  const apiKey = (settings.xcel_api_key || '').trim()
  const defaultMerchant = (settings.xcel_default_merchant_id || '').trim()
  const billerChannel = (settings.xcel_biller_channel || 'FUNDGATE').trim()

  const merchantId =
    (product?.xcel_merchant_id || '').trim() || defaultMerchant
  const toAcct = (product?.xcel_to_acct || '').trim() || fromAcct
  const billerWallet = (product?.xcel_biller_wallet_num || '').trim()
  const providerCode = (product?.provider_code || order.network || '').trim()
  const billSubType =
    (product?.bill_sub_type ||
      (order.service_type === 'airtime'
        ? 'airtime'
        : order.service_type === 'ecg'
          ? 'electricity'
          : 'CABLE')) as string
  const xcelType =
    (product?.xcel_type ||
      (order.service_type === 'airtime'
        ? 'topup'
        : order.service_type === 'ecg'
          ? 'electricity'
          : 'cable')) as string

  const face = Number(order.face_amount ?? order.amount)
  const amountStr = face.toFixed(2)
  const beneficiary = String(order.phone)
  const meta = order.utility_meta ?? {}
  const accountName =
    String(meta.account_name ?? product?.xcel_account_name ?? providerCode ?? 'Customer')

  if (!userId || !fromAcct || !merchantId) {
    await supabase
      .from('orders')
      .update({
        provider_status: 'failed',
        provider_error: 'Xcel credentials incomplete (user_id / from_acct / merchant_id)',
        status: 'failed',
        failure_reason: 'xcel_misconfigured',
      })
      .eq('id', order.id)
    return { id: order.id, success: false, error: 'misconfigured' }
  }

  const authHeaders: Record<string, string> = {}
  if (apiKey) {
    authHeaders.Authorization = `Bearer ${apiKey}`
    authHeaders['X-API-Key'] = apiKey
  }

  let dlCode = crypto.randomUUID()
  let secret = hmacSecret
    ? await hmacSha256Hex(hmacSecret, `${dlCode}${amountStr}${beneficiary}`)
    : ''

  try {
    const dl = await requestDlCode(base, dlPath, authHeaders, {
      merchant_id: merchantId,
      utility: true,
      from_acct: fromAcct,
      user_id: userId,
      amount: amountStr,
      to_bill_number: beneficiary,
      description: `${order.service_type} ${providerCode} ${beneficiary}`,
    })
    if (dl.dl_code) dlCode = dl.dl_code
    if (dl.secret) secret = dl.secret
    else if (hmacSecret) secret = await hmacSha256Hex(hmacSecret, dlCode)
  } catch {
    /* fall back to local dl_code */
  }

  const payload: Record<string, unknown> = {
    from_country: 'GH',
    to_country: 'GH',
    from_currency: 'GHS',
    to_currency: 'GHS',
    channel: 'XCel',
    from_amount: amountStr,
    to_amount: amountStr,
    dl_code: dlCode,
    secret,
    type: xcelType,
    bill_sub_type: billSubType,
    to_provider_code: providerCode,
    to_bill_number: beneficiary,
    account_name: accountName,
    bill_beneficiary_name: accountName,
    biller_channel: billerChannel,
    to_merchant_id: merchantId,
    merchant_id: merchantId,
    from_business: true,
    from_acct: fromAcct,
    to_acct: toAcct,
    user_id: userId,
    pin,
    description: `${String(order.service_type).toUpperCase()} ${providerCode} for ${beneficiary}`,
  }

  if (billerWallet) payload.biller_wallet_num = billerWallet
  if (order.service_type === 'ecg') {
    payload.additional_bill_code = beneficiary
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}${buyPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(payload),
    })
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const ok =
      res.ok &&
      (raw.success === true ||
        String(raw.status ?? '').toLowerCase() === 'success' ||
        String(raw.status ?? '').toLowerCase() === 'successful' ||
        Boolean(raw.transaction_id || raw.reference_no || raw.token))

    const token = raw.token ? String(raw.token) : null
    const txId = String(raw.transaction_id ?? raw.reference_no ?? raw.id ?? '')
    const nextMeta = {
      ...meta,
      xcel_response: raw,
      ...(token ? { token } : {}),
    }

    if (ok) {
      await supabase
        .from('orders')
        .update({
          provider_status: 'success',
          provider_reference: txId || dlCode,
          provider_order_number: txId || null,
          provider_error: null,
          status: 'completed',
          completed_at: new Date().toISOString(),
          utility_meta: nextMeta,
        })
        .eq('id', order.id)
      return { id: order.id, success: true, reference: txId || dlCode }
    }

    const errMsg = String(raw.message ?? raw.error ?? raw.description ?? `HTTP ${res.status}`)
    await supabase
      .from('orders')
      .update({
        provider_status: 'failed',
        provider_error: errMsg.slice(0, 500),
        status: 'failed',
        failure_reason: 'xcel_rejected',
        utility_meta: nextMeta,
      })
      .eq('id', order.id)
    return { id: order.id, success: false, error: errMsg }
  } catch (e) {
    const errMsg = (e as Error).message
    await supabase
      .from('orders')
      .update({
        provider_status: 'failed',
        provider_error: errMsg.slice(0, 500),
        status: 'failed',
        failure_reason: 'xcel_error',
      })
      .eq('id', order.id)
    return { id: order.id, success: false, error: errMsg }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  let path = url.pathname
  const idx = path.indexOf('/fulfill-xcel-orders')
  if (idx >= 0) path = path.slice(idx + '/fulfill-xcel-orders'.length) || '/'
  path = path.replace(/\/+$/, '') || '/'

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: settingsRows } = await supabase.from('site_settings').select('key, value')
  const settings = settingsMap((settingsRows ?? []) as Array<{ key: string; value: string }>)

  if ((settings.xcel_enabled || 'false') !== 'true') {
    return json({ success: false, error: 'Xcel utilities disabled' }, 503)
  }

  if (path === '/health' && req.method === 'GET') {
    return json({ success: true, status: 'operational', provider: 'xcel' })
  }

  let orders: OrderRow[] = []

  if (path.startsWith('/order/') && req.method === 'POST') {
    const orderId = path.replace('/order/', '')
    const { data } = await supabase
      .from('orders')
      .select(
        'id, reference, phone, network, amount, face_amount, service_type, utility_product_id, utility_meta, status, provider_submitted_at',
      )
      .eq('id', orderId)
      .maybeSingle()
    if (!data) return json({ success: false, error: 'Order not found' }, 404)
    if (!['airtime', 'ecg', 'tv'].includes(String(data.service_type))) {
      return json({ success: false, error: 'Not a utility order' }, 400)
    }
    orders = [data as OrderRow]
  } else if ((path === '/process' || path === '/') && req.method === 'POST') {
    const { data } = await supabase.rpc('get_orders_pending_xcel', { p_limit: 30 })
    orders = (data ?? []) as OrderRow[]
  } else {
    return json({ success: false, error: 'Not found' }, 404)
  }

  const productIds = [
    ...new Set(orders.map((o) => o.utility_product_id).filter(Boolean) as string[]),
  ]
  const { data: products } = productIds.length
    ? await supabase.from('utility_products').select('*').in('id', productIds)
    : { data: [] as UtilityProduct[] }
  const productMap = new Map(
    ((products ?? []) as UtilityProduct[]).map((p) => [p.id, p]),
  )

  const results = []
  for (const order of orders) {
    const product = order.utility_product_id
      ? productMap.get(order.utility_product_id) ?? null
      : null
    results.push(await fulfillOne(supabase, order, settings, product))
  }

  return json({ success: true, processed: results.length, results })
})
