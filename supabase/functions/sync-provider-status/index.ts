import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-datahub-signature, x-webhook-signature, x-bundlezone-timestamp, x-bundlezone-signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DATAHUB_BASE = 'https://user.datahubgh.com/api/external'
const SKPLUG_BASE = 'https://skdataplug.com/api/v1'
const DATAMART_BASE = 'https://api.datamartgh.shop/api/developer'
const BUNDLEZONE_BASE = 'https://bundlezone.shop/api'
const BUNDLEZONE_WEBHOOK_MAX_AGE_SECONDS = 300
const SPENDLESS_BASE = 'https://spendless.top/api'
const SPENDLESS_PAGE_SIZE = 100
const SPENDLESS_MAX_PAGES = 10
const SPENDLESS_CACHE_MS = 10_000
const SKPLUG_REFUND_SYNC_INTERVAL_MS = 120_000

type ProviderType = 'datahub' | 'skplug' | 'datamart' | 'bundlezone' | 'spendless'

const PROVIDER_SLUGS = ['primary', 'secondary', 'tertiary', 'quaternary', 'quinary'] as const

const SLOT_DEFAULT_TYPE: Record<string, ProviderType> = {
  primary: 'datahub',
  secondary: 'skplug',
  tertiary: 'datahub',
  quaternary: 'bundlezone',
  quinary: 'spendless',
}

type OrderRow = {
  id: string
  reference: string
  status: string
  provider_reference: string | null
  provider_order_number: string | null
  provider_status: string | null
  provider_type: string | null
  provider_name: string | null
  provider_attempt_id?: string | null
  provider_route_round?: number | null
  provider_submitted_at?: string | null
  provider_attempts?: number | null
  created_at?: string
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
  if (['refunded', 'reversed'].includes(s)) {
    return { providerStatus: 'refunded', orderStatus: 'failed' }
  }
  if (['processing', 'in_progress', 'in-progress', 'pending', 'submitted', 'placed', 'waiting', 'initiated'].includes(s)) {
    return {
      providerStatus:
        s === 'pending'
          ? 'pending'
          : s === 'submitted' || s === 'placed'
            ? 'submitted'
            : s === 'waiting'
              ? 'waiting'
              : s === 'initiated'
                ? 'initiated'
                : 'processing',
      orderStatus: 'processing',
    }
  }
  return { providerStatus: raw, orderStatus: null }
}

/** Provider confirmed the order will not be delivered (failed or refunded), so it is safe to re-route. */
function isProviderFailure(raw: string) {
  const mapped = mapProviderStatus(raw).providerStatus
  return mapped === 'failed' || mapped === 'refunded'
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

async function fetchDatamartStatus(apiKey: string, reference: string) {
  const ref = reference.trim()
  if (!ref) return { ok: false, status: null, body: { error: 'No reference' } }
  const res = await fetch(`${DATAMART_BASE}/order-status/${encodeURIComponent(ref)}`, {
    headers: { 'X-API-Key': apiKey },
  })
  const body = await res.json().catch(() => ({}))
  const data = (body?.data ?? {}) as Record<string, unknown>
  const status = data.status ?? body?.status
  if (status && String(status).toLowerCase() !== 'error') {
    return { ok: true, status: String(status), body }
  }
  return { ok: false, status: null, body }
}

async function fetchBundlezoneStatus(apiKey: string, reference: string | null, orderId: string | null) {
  const lookups: Array<[string, string]> = []
  if (reference) lookups.push(['reference', reference])
  if (orderId) lookups.push(['order_id', orderId])
  if (lookups.length === 0) return { ok: false, status: null, body: { error: 'No BundleZone reference' } }

  let lastBody: unknown = null
  for (const [param, value] of lookups) {
    const res = await fetch(
      `${BUNDLEZONE_BASE}/status.php?${param}=${encodeURIComponent(value)}`,
      { headers: { 'x-api-key': apiKey, Accept: 'application/json' } },
    )
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    lastBody = body
    const data = (body.data ?? {}) as Record<string, unknown>
    const order = (data.order ?? {}) as Record<string, unknown>
    const status = order.status ?? data.status ?? (body.success ? body.status : null)
    if (body.success && status) return { ok: true, status: String(status), body }
  }
  return { ok: false, status: null, body: lastBody ?? { error: 'Status not found' } }
}

type SpendlessTx = Record<string, unknown>
const spendlessPageCache = new Map<string, { at: number; pages: SpendlessTx[][] }>()

async function spendlessTransactionsPage(apiKey: string, page: number): Promise<SpendlessTx[] | null> {
  let entry = spendlessPageCache.get(apiKey)
  if (!entry || Date.now() - entry.at > SPENDLESS_CACHE_MS) {
    entry = { at: Date.now(), pages: [] }
    spendlessPageCache.set(apiKey, entry)
  }
  if (entry.pages[page - 1]) return entry.pages[page - 1]

  const res = await fetch(`${SPENDLESS_BASE}/transactions?limit=${SPENDLESS_PAGE_SIZE}&page=${page}`, {
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const data = (body.data ?? {}) as Record<string, unknown>
  if (body.status !== 'success' || !Array.isArray(data.transactions)) return null
  entry.pages[page - 1] = data.transactions as SpendlessTx[]
  return entry.pages[page - 1]
}

/** Spendless has no working per-order status endpoint, so find the order in recent transactions. */
async function fetchSpendlessStatus(
  apiKey: string,
  reference: string | null,
  orderId: string | null,
  submittedAt: string | null | undefined,
) {
  if (!reference && !orderId) return { ok: false, status: null, body: { error: 'No Spendless reference' } }
  const oldestWanted = submittedAt ? Date.parse(submittedAt) - 60 * 60 * 1000 : null

  for (let page = 1; page <= SPENDLESS_MAX_PAGES; page++) {
    const txs = await spendlessTransactionsPage(apiKey, page)
    if (!txs) return { ok: false, status: null, body: { error: 'Spendless transactions unavailable' } }
    const match = txs.find(
      (t) =>
        (reference && String(t.reference ?? '') === reference) ||
        (orderId && String(t.orderId ?? '') === orderId),
    )
    if (match?.status) return { ok: true, status: String(match.status), body: match }
    if (txs.length < SPENDLESS_PAGE_SIZE) break
    const oldest = String(txs[txs.length - 1]?.rawCreatedAt ?? '')
    const oldestAt = oldest ? Date.parse(`${oldest.replace(' ', 'T')}Z`) : NaN
    if (oldestWanted !== null && !Number.isNaN(oldestAt) && oldestAt < oldestWanted) break
  }
  return { ok: false, status: null, body: { error: 'Order not found in recent Spendless transactions' } }
}

function resolveProviderType(order: OrderRow): ProviderType {
  if (
    order.provider_type === 'skplug' ||
    order.provider_type === 'datahub' ||
    order.provider_type === 'datamart' ||
    order.provider_type === 'bundlezone' ||
    order.provider_type === 'spendless'
  ) {
    return order.provider_type
  }
  const name = order.provider_name?.toLowerCase() ?? ''
  if (name.includes('spendless')) return 'spendless'
  if (name.includes('sk plug') || name.includes('skplug')) return 'skplug'
  if (name.includes('datamart')) return 'datamart'
  if (name.includes('bundlezone') || name.includes('bundle zone')) return 'bundlezone'
  return 'datahub'
}

function credentialsForType(
  settingsMap: Record<string, string>,
  type: ProviderType,
): string[] {
  const slots: Array<{ type: string; key: string }> = [
    {
      type: (settingsMap.data_provider_primary_type || 'datahub').trim().toLowerCase(),
      key: settingsMap.data_provider_primary_api_key?.trim() || '',
    },
    {
      type: (settingsMap.data_provider_secondary_type || 'skplug').trim().toLowerCase(),
      key: settingsMap.data_provider_secondary_api_key?.trim() || '',
    },
    {
      type: (settingsMap.data_provider_tertiary_type || 'datahub').trim().toLowerCase(),
      key: settingsMap.data_provider_tertiary_api_key?.trim() || '',
    },
    {
      type: (settingsMap.data_provider_quaternary_type || 'bundlezone').trim().toLowerCase(),
      key: settingsMap.data_provider_quaternary_api_key?.trim() || '',
    },
    {
      type: (settingsMap.data_provider_quinary_type || 'spendless').trim().toLowerCase(),
      key: settingsMap.data_provider_quinary_api_key?.trim() || '',
    },
  ]
  const keys = slots.filter((s) => s.type === type && s.key).map((s) => s.key)
  if (type === 'datamart') keys.push(settingsMap.datamart_api_key?.trim() || '')
  if (type === 'datahub') keys.push(Deno.env.get('DATAHUB_API_KEY')?.trim() || '')
  if (keys.filter(Boolean).length === 0 && type !== 'bundlezone' && type !== 'spendless') {
    keys.push(...slots.map((s) => s.key))
  }
  return [...new Set(keys.filter(Boolean))]
}

function hexFromBuffer(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256Hex(secret: string, payload: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return hexFromBuffer(sig)
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

async function verifyDatahubSignature(req: Request, rawBody: string, secret: string) {
  if (!secret) return true
  const header =
    req.headers.get('x-webhook-signature') ??
    req.headers.get('X-Webhook-Signature') ??
    req.headers.get('x-datahub-signature') ??
    ''
  if (!header) return true
  const provided = header.replace(/^sha256=/i, '').trim().toLowerCase()
  const expected = (await hmacSha256Hex(secret, rawBody)).toLowerCase()
  return timingSafeEqual(provided, expected)
}

async function verifyBundlezoneSignature(req: Request, rawBody: string, secret: string) {
  if (!secret) return { ok: false, error: 'BundleZone webhook secret is not configured' }
  const timestamp = req.headers.get('x-bundlezone-timestamp')?.trim() ?? ''
  const header = req.headers.get('x-bundlezone-signature')?.trim() ?? ''
  if (!/^\d+$/.test(timestamp) || !header) {
    return { ok: false, error: 'Missing webhook authentication' }
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > BUNDLEZONE_WEBHOOK_MAX_AGE_SECONDS) {
    return { ok: false, error: 'Expired webhook timestamp' }
  }
  const provided = header.replace(/^sha256=/i, '').toLowerCase()
  const expected = (await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)).toLowerCase()
  return timingSafeEqual(provided, expected)
    ? { ok: true, error: null }
    : { ok: false, error: 'Invalid webhook signature' }
}

async function handleBundlezoneWebhook(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  rawBody: string,
  settingsMap: Record<string, string>,
) {
  const verified = await verifyBundlezoneSignature(
    req,
    rawBody,
    settingsMap.bundlezone_webhook_secret?.trim() || '',
  )
  if (!verified.ok) return json({ success: false, error: verified.error }, 401)

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody || '{}') as Record<string, unknown>
  } catch {
    return json({ success: false, error: 'Invalid JSON payload' }, 400)
  }

  if (body.event !== 'order.status_changed') {
    return json({ success: true, ignored: true, event: body.event ?? null })
  }

  const data = (body.data ?? {}) as Record<string, unknown>
  const status = data.status ? String(data.status) : null
  if (!status) return json({ success: false, error: 'Missing status in webhook payload' }, 400)

  const reference = data.reference ? String(data.reference) : null
  const orderId = data.order_id != null ? String(data.order_id) : null

  let order: Record<string, unknown> | null = null
  if (reference) {
    const { data: row } = await supabase
      .from('orders')
      .select('*')
      .eq('provider_type', 'bundlezone')
      .eq('provider_reference', reference)
      .maybeSingle()
    order = row
  }
  if (!order && orderId) {
    const { data: row } = await supabase
      .from('orders')
      .select('*')
      .eq('provider_type', 'bundlezone')
      .eq('provider_order_number', orderId)
      .maybeSingle()
    order = row
  }
  if (!order && data.recipient && data.capacity != null) {
    const { data: rows } = await supabase
      .from('orders')
      .select('*')
      .eq('provider_type', 'bundlezone')
      .eq('phone', String(data.recipient))
      .eq('size_gb', Number(data.capacity))
      .is('provider_reference', null)
      .is('provider_order_number', null)
      .in('status', ['pending', 'processing'])
      .order('provider_submitted_at', { ascending: false })
      .limit(1)
    order = rows?.[0] ?? null
  }

  if (!order) {
    return json({ success: true, message: 'Order not found locally', reference, order_id: orderId })
  }

  const row = order as unknown as OrderRow
  const refs: Record<string, unknown> = {}
  if (reference && !row.provider_reference) refs.provider_reference = reference
  if (orderId && !row.provider_order_number) refs.provider_order_number = orderId
  if (row.provider_attempt_id && Object.keys(refs).length > 0) {
    await supabase.from('order_provider_attempts').update(refs).eq('id', row.provider_attempt_id)
  }

  if (isProviderFailure(status)) {
    const outcome = await handleProviderFailure(supabase, row, settingsMap, status, 'BundleZone webhook')
    return json({ success: true, order_id: row.id, ...outcome })
  }

  const applied = await applyProviderStatus(supabase, row, status, refs)
  return json({ success: true, order_id: row.id, status: applied.order_status })
}

async function handleSpendlessWebhook(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  rawBody: string,
  settingsMap: Record<string, string>,
) {
  const secret = settingsMap.spendless_webhook_secret?.trim() || ''
  if (secret) {
    const provided = (req.headers.get('x-webhook-signature')?.trim() ?? '').replace(/^sha256=/i, '').toLowerCase()
    const expected = (await hmacSha256Hex(secret, rawBody)).toLowerCase()
    if (!timingSafeEqual(provided, expected)) {
      return json({ success: false, error: 'Invalid webhook signature' }, 401)
    }
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody || '{}') as Record<string, unknown>
  } catch {
    return json({ success: false, error: 'Invalid JSON payload' }, 400)
  }

  const data = (body.data ?? {}) as Record<string, unknown>
  const reference = data.reference ? String(data.reference) : null
  if (!reference) return json({ success: false, error: 'Missing reference in webhook payload' }, 400)

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('provider_type', 'spendless')
    .eq('provider_reference', reference)
    .maybeSingle()
  if (!order) return json({ success: true, message: 'Order not found locally', reference })

  // The payload is only a hint; the status is re-read from Spendless before anything changes.
  const result = await syncOrderStatus(supabase, order as OrderRow, settingsMap)
  return json({ success: true, order_id: (order as OrderRow).id, confirmed_by_status_check: true, result })
}

function shouldApplyOrderStatus(current: string, next: string | null) {
  if (!next || next === current) return false
  if (current === 'completed' && next === 'processing') return false
  return true
}

function isRerouteEnabled(settingsMap: Record<string, string>) {
  return settingsMap.provider_auto_reroute_enabled !== 'false'
}

function slotCredential(settingsMap: Record<string, string>, slug: string) {
  const key = settingsMap[`data_provider_${slug}_api_key`]?.trim() || ''
  if (key) return key
  const type = (settingsMap[`data_provider_${slug}_type`] || SLOT_DEFAULT_TYPE[slug] || '').trim().toLowerCase()
  return type === 'datahub' ? Deno.env.get('DATAHUB_API_KEY')?.trim() || '' : ''
}

/** Same ordering as fulfill-orders: active slot first, then the fallback chain; slots without a key are skipped. */
function rerouteCandidates(settingsMap: Record<string, string>) {
  const parse = (raw: string | undefined) => {
    const s = (raw ?? '').trim().toLowerCase()
    return (PROVIDER_SLUGS as readonly string[]).includes(s) ? s : null
  }
  const active = parse(settingsMap.active_data_provider) ?? 'primary'
  const configured = (settingsMap.provider_reroute_chain || PROVIDER_SLUGS.join(','))
    .split(',')
    .map(parse)
    .filter((s): s is string => s !== null)
  return [...new Set([active, ...configured])].filter((slug) => slotCredential(settingsMap, slug))
}

function triggerFulfillment(orderId: string) {
  const base = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!base || !key) return
  const pending = fetch(`${base}/functions/v1/fulfill-orders/order/${orderId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => {
    /* the 15s fulfillment poll picks the order up anyway */
  })
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  runtime?.waitUntil?.(pending)
}

/**
 * Orders sent before re-routing existed have no attempt row. Record the failed send against the
 * slot that holds this provider so fulfill-orders skips it when re-routing.
 */
async function recordLegacyAttempt(
  supabase: ReturnType<typeof createClient>,
  order: OrderRow,
  settingsMap: Record<string, string>,
  reason: string,
) {
  const type = resolveProviderType(order)
  const slot = PROVIDER_SLUGS.find((slug) => {
    const slotType = (settingsMap[`data_provider_${slug}_type`] || SLOT_DEFAULT_TYPE[slug]).trim().toLowerCase()
    return slotType === type && slotCredential(settingsMap, slug)
  })
  if (!slot) return false

  const { error } = await supabase.from('order_provider_attempts').upsert(
    {
      order_id: order.id,
      route_round: order.provider_route_round ?? 0,
      attempt_no: (order.provider_attempts ?? 0) + 1,
      provider_slot: slot,
      provider_type: type,
      provider_name: order.provider_name ?? type,
      outcome: 'failed_later',
      provider_reference: order.provider_reference,
      provider_order_number: order.provider_order_number,
      error: reason,
      finished_at: new Date().toISOString(),
    },
    { onConflict: 'order_id,route_round,provider_slot', ignoreDuplicates: true },
  )
  return !error
}

/**
 * SK Plug refunds can land after the auto-deliver timer has marked an order completed, when
 * per-order polling has already stopped. orders-summary lists every refunded order in one call.
 */
async function reconcileSkplugRefunds(
  supabase: ReturnType<typeof createClient>,
  settingsMap: Record<string, string>,
) {
  if (settingsMap.skplug_refund_reroute_enabled === 'false') return { skipped: 'disabled' }
  const tokens = credentialsForType(settingsMap, 'skplug')
  if (tokens.length === 0) return { skipped: 'no SK Plug token' }

  const now = new Date()
  const { data: claimed } = await supabase
    .from('site_settings')
    .update({ value: now.toISOString(), updated_at: now.toISOString() })
    .eq('key', 'skplug_refund_sync_last_at')
    .lt('value', new Date(now.getTime() - SKPLUG_REFUND_SYNC_INTERVAL_MS).toISOString())
    .select('key')
  if (!claimed?.length) return { skipped: 'ran recently' }

  const maxAgeHours = Number(settingsMap.provider_refund_reroute_max_age_hours) || 48
  const since = now.getTime() - maxAgeHours * 60 * 60 * 1000

  const refundedIds = new Set<string>()
  for (const token of tokens) {
    const res = await fetch(`${SKPLUG_BASE}/orders-summary/`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }).catch(() => null)
    if (!res?.ok) continue
    const body = (await res.json().catch(() => ({}))) as Record<string, { orders?: Array<Record<string, unknown>> }>
    for (const bucket of ['refunded', 'refund_requested']) {
      for (const o of body[bucket]?.orders ?? []) {
        const id = String(o.order_id ?? '')
        const createdAt = o.created_at ? Date.parse(String(o.created_at)) : NaN
        if (!id || String(o.status ?? '').toLowerCase() !== 'refunded') continue
        if (!Number.isNaN(createdAt) && createdAt < since) continue
        refundedIds.add(id)
      }
    }
  }
  if (refundedIds.size === 0) return { checked: 0, rerouted: 0 }

  const ids = [...refundedIds]
  const results = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data: rows } = await supabase
      .from('orders')
      .select('*')
      .eq('provider_type', 'skplug')
      .in('provider_order_number', ids.slice(i, i + 100))
      .not('provider_status', 'in', '("refunded","failed","rerouting")')
      .gte('created_at', new Date(since).toISOString())
    for (const row of (rows ?? []) as OrderRow[]) {
      const outcome = await handleProviderFailure(supabase, row, settingsMap, 'refunded', 'SK Plug orders-summary')
      results.push({ order_id: row.id, reference: row.reference, ...outcome })
    }
  }
  return {
    checked: refundedIds.size,
    rerouted: results.filter((r) => r.rerouted).length,
    results,
  }
}

/**
 * The provider handling the order's current attempt reported a final failure.
 * Re-route to the next untried provider, or fail the order when none are left.
 * Every write is conditional on provider_attempt_id so a late report about an
 * earlier attempt can never bounce an order that is already live elsewhere.
 */
async function handleProviderFailure(
  supabase: ReturnType<typeof createClient>,
  order: OrderRow,
  settingsMap: Record<string, string>,
  rawStatus: string,
  source: string,
) {
  const attemptId = order.provider_attempt_id ?? null
  const reason = `${order.provider_name ?? 'Provider'} reported "${rawStatus}" (${source})`
  const finalProviderStatus = mapProviderStatus(rawStatus).providerStatus

  if (!attemptId && order.provider_status === 'rerouting') {
    return { rerouted: false, stale: true, order_status: order.status }
  }

  if (attemptId) {
    await supabase
      .from('order_provider_attempts')
      .update({ outcome: 'failed_later', error: reason, finished_at: new Date().toISOString() })
      .eq('id', attemptId)
      .eq('outcome', 'accepted')
  }

  // Orders already marked failed may have been refunded to the customer, so never re-send them.
  const legacyRecorded =
    !attemptId && order.status !== 'failed' && isRerouteEnabled(settingsMap)
      ? await recordLegacyAttempt(supabase, order, settingsMap, reason)
      : false

  if ((attemptId || legacyRecorded) && order.status !== 'failed' && isRerouteEnabled(settingsMap)) {
    const { data: tried } = await supabase
      .from('order_provider_attempts')
      .select('provider_slot')
      .eq('order_id', order.id)
      .eq('route_round', order.provider_route_round ?? 0)
    const triedSlots = new Set((tried ?? []).map((t) => String(t.provider_slot)))
    const remaining = rerouteCandidates(settingsMap).filter((slug) => !triedSlots.has(slug))

    if (remaining.length > 0) {
      let resetQuery = supabase
        .from('orders')
        .update({
          provider_submitted_at: null,
          provider_status: 'rerouting',
          provider_reference: null,
          provider_order_number: null,
          provider_attempt_id: null,
          provider_error: `${reason} — re-routing to the next provider`,
        })
        .eq('id', order.id)
      if (attemptId) {
        resetQuery = resetQuery.eq('provider_attempt_id', attemptId)
      } else {
        resetQuery = resetQuery.is('provider_attempt_id', null)
        resetQuery = order.provider_status
          ? resetQuery.eq('provider_status', order.provider_status)
          : resetQuery.is('provider_status', null)
      }
      const { data: reset } = await resetQuery.select('id')
      if (reset?.length) {
        triggerFulfillment(order.id)
        return { rerouted: true, next_slots: remaining, order_status: order.status }
      }
      return { rerouted: false, stale: true, order_status: order.status }
    }
  }

  const update: Record<string, unknown> = { provider_status: finalProviderStatus, provider_error: reason }
  if (shouldApplyOrderStatus(order.status, 'failed')) {
    update.status = 'failed'
    update.failure_reason = reason
  }
  await guardedOrderUpdate(supabase, order, update)
  return { rerouted: false, final: true, order_status: update.status ?? order.status }
}

/** Update only if the order is still on the attempt (or, for pre-reroute orders, the provider status) we read. */
function guardedOrderUpdate(
  supabase: ReturnType<typeof createClient>,
  order: OrderRow,
  update: Record<string, unknown>,
) {
  let query = supabase.from('orders').update(update).eq('id', order.id)
  if (order.provider_attempt_id) {
    query = query.eq('provider_attempt_id', order.provider_attempt_id)
  } else {
    query = query.is('provider_attempt_id', null)
    if (order.provider_status) query = query.eq('provider_status', order.provider_status)
  }
  return query
}

/** Apply a non-failure provider status, only if the order is still on the same attempt. */
async function applyProviderStatus(
  supabase: ReturnType<typeof createClient>,
  order: OrderRow,
  rawStatus: string,
  extra: Record<string, unknown> = {},
) {
  if (!order.provider_attempt_id && order.provider_status === 'rerouting') {
    return { provider_status: 'rerouting', order_status: order.status, stale: true }
  }
  const mapped = mapProviderStatus(rawStatus)
  const update: Record<string, unknown> = { provider_status: mapped.providerStatus, ...extra }
  if (mapped.orderStatus && shouldApplyOrderStatus(order.status, mapped.orderStatus)) {
    update.status = mapped.orderStatus
    if (mapped.orderStatus === 'completed') update.completed_at = new Date().toISOString()
  }
  await guardedOrderUpdate(supabase, order, update)
  return { provider_status: mapped.providerStatus, order_status: update.status ?? order.status }
}

async function credentialsForOrder(
  supabase: ReturnType<typeof createClient>,
  order: OrderRow,
  settingsMap: Record<string, string>,
  providerType: ProviderType,
) {
  const keys: string[] = []
  if (order.provider_attempt_id) {
    const { data } = await supabase
      .from('order_provider_attempts')
      .select('provider_slot')
      .eq('id', order.provider_attempt_id)
      .maybeSingle()
    const key = data?.provider_slot ? slotCredential(settingsMap, String(data.provider_slot)) : ''
    if (key) keys.push(key)
  }
  keys.push(...credentialsForType(settingsMap, providerType))
  return [...new Set(keys)]
}

async function syncOrderStatus(
  supabase: ReturnType<typeof createClient>,
  order: OrderRow,
  settingsMap: Record<string, string>,
) {
  const providerType = resolveProviderType(order)
  const credentials = await credentialsForOrder(supabase, order, settingsMap, providerType)
  if (credentials.length === 0) {
    const label = {
      bundlezone: 'BundleZone API key',
      spendless: 'Spendless API key',
      skplug: 'SK Plug token',
      datamart: 'DataMart API key',
      datahub: 'Datahub key',
    }
    return { order_id: order.id, skipped: true, reason: `No ${label[providerType]}` }
  }

  let result: { ok: boolean; status: string | null; body: unknown } = { ok: false, status: null, body: {} }
  for (const credential of credentials) {
    if (providerType === 'bundlezone') {
      result = await fetchBundlezoneStatus(credential, order.provider_reference, order.provider_order_number)
    } else if (providerType === 'spendless') {
      result = await fetchSpendlessStatus(
        credential,
        order.provider_reference,
        order.provider_order_number,
        order.provider_submitted_at,
      )
    } else if (providerType === 'skplug') {
      const orderId = order.provider_order_number ?? order.provider_reference ?? order.reference
      result = await fetchSkplugStatus(credential, orderId)
    } else if (providerType === 'datamart') {
      const ref = order.provider_reference ?? order.provider_order_number ?? order.reference
      result = await fetchDatamartStatus(credential, ref)
    } else {
      result = await fetchDatahubStatus(
        credential,
        order.provider_reference ?? order.reference,
        order.provider_order_number,
      )
    }
    if (result.ok && result.status) break
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

  if (isProviderFailure(result.status)) {
    const outcome = await handleProviderFailure(supabase, order, settingsMap, result.status, 'status check')
    return {
      order_id: order.id,
      reference: order.reference,
      success: true,
      provider_type: providerType,
      provider_status: outcome.rerouted ? 'rerouting' : mapProviderStatus(result.status).providerStatus,
      raw_status: result.status,
      ...outcome,
    }
  }

  const applied = await applyProviderStatus(supabase, order, result.status)
  return {
    order_id: order.id,
    reference: order.reference,
    success: true,
    provider_type: providerType,
    ...applied,
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
    if (isWebhook && req.method === 'POST' && path.includes('/bundlezone')) {
      const rawBody = await req.text()
      const { data: settings } = await supabase.from('site_settings').select('key, value')
      const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))
      return await handleBundlezoneWebhook(supabase, req, rawBody, settingsMap)
    }

    if (isWebhook && req.method === 'POST' && path.includes('/spendless')) {
      const rawBody = await req.text()
      const { data: settings } = await supabase.from('site_settings').select('key, value')
      const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))
      return await handleSpendlessWebhook(supabase, req, rawBody, settingsMap)
    }

    if (isWebhook && req.method === 'POST') {
      const rawBody = await req.text()
      const body = (() => {
        try {
          return JSON.parse(rawBody || '{}') as Record<string, unknown>
        } catch {
          return {} as Record<string, unknown>
        }
      })()

      const { data: settings } = await supabase.from('site_settings').select('key, value')
      const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))
      const secret = settingsMap.datahub_webhook_secret?.trim() || ''
      if (!(await verifyDatahubSignature(req, rawBody, secret))) {
        return json({ success: false, error: 'Invalid webhook signature' }, 401)
      }

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

      const row = order as OrderRow
      if (resolveProviderType(row) !== 'datahub') {
        return json({ success: true, ignored: true, reason: 'Order is no longer with Datahub', order_id: row.id })
      }

      // Datahub references are our own order references, so a failure callback cannot be tied
      // to a specific attempt. Confirm against the current attempt before re-routing.
      if (isProviderFailure(status)) {
        const confirmed = await syncOrderStatus(supabase, row, settingsMap)
        return json({ success: true, order_id: row.id, confirmed_by_status_check: true, result: confirmed })
      }

      const applied = await applyProviderStatus(supabase, row, status)
      return json({ success: true, order_id: row.id, status: applied.order_status })
    }

    if (req.method === 'POST' && (path === '/process' || path === '/')) {
      const { data: settings } = await supabase.from('site_settings').select('key, value')
      const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))

      if (settingsMap.provider_status_sync_enabled === 'false') {
        return json({ success: true, processed: 0, message: 'Provider status sync disabled' })
      }

      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100)
      const { data: orders, error } = await supabase.rpc('get_orders_pending_provider_status', {
        p_limit: limit,
      })

      if (error) {
        return json({ success: false, error: error.message }, 500)
      }

      const results = []
      for (const order of (orders as OrderRow[]) ?? []) {
        results.push(await syncOrderStatus(supabase, order, settingsMap))
      }

      const skplugRefunds = await reconcileSkplugRefunds(supabase, settingsMap).catch((e) => ({
        error: (e as Error).message,
      }))

      return json({
        success: true,
        processed: results.length,
        updated: results.filter((r) => r.success && !r.unchanged).length,
        results,
        skplug_refunds: skplugRefunds,
      })
    }

    if (req.method === 'GET' && path === '/health') {
      return json({ success: true, service: 'sync-provider-status' })
    }

    return json({
      success: true,
      endpoints: {
        'POST /process': 'Poll provider APIs, update order statuses, and re-route SK Plug refunds',
        'POST /provider-webhook/datahub': 'Receive Datahub webhook callbacks',
        'POST /provider-webhook/bundlezone': 'Receive signed BundleZone order.status_changed callbacks',
        'POST /provider-webhook/spendless': 'Receive Spendless order status callbacks (confirmed via API)',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
