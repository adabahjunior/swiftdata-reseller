import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

type Client = ReturnType<typeof createClient>
type Settings = Record<string, string>

const DATAMART_BASE = 'https://api.datamartgh.shop/api/developer'
const REQUEST_TIMEOUT_MS = 25_000
const LANE_RECHECK_MS = 15 * 60_000
const STATUS_SYNC_INTERVAL_MS = 30_000
const STATUS_SYNC_MAX_AGE_MS = 3 * 24 * 60 * 60_000

/** DataMart refused the purchase and charged nothing; the lane stays closed until a re-check. */
const LANE_CLOSING_CODES = new Set(['MASHUP_NOT_ENABLED', 'MASHUP_UNAVAILABLE', 'INSUFFICIENT_BALANCE', 'API_KEY_REQUIRED'])
/** DataMart refused the purchase and charged nothing. */
const REJECT_CODES = new Set([...LANE_CLOSING_CODES, 'UNKNOWN_PACKAGE', 'INVALID_PHONE'])

const ORDER_COLUMNS =
  'id, reference, phone, status, amount, service_type, provider_route_round, provider_submitted_at, provider_reference, provider_status, utility_meta'

type MashupOrder = {
  id: string
  reference: string
  phone: string
  status: string
  amount: number
  service_type: string
  provider_route_round: number | null
  provider_submitted_at: string | null
  provider_reference: string | null
  provider_status: string | null
  utility_meta: Record<string, unknown> | null
}

type Reply = { httpStatus: number | null; body: Record<string, unknown>; networkError?: string }

async function datamart(apiKey: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply> {
  try {
    const res = await fetch(`${DATAMART_BASE}${path}`, {
      method,
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { httpStatus: res.status, body: parsed }
  } catch (e) {
    return { httpStatus: null, body: {}, networkError: (e as Error).message || 'Network error' }
  }
}

function replyMessage(reply: Reply) {
  if (reply.networkError) return `Network error: ${reply.networkError}`
  const code = reply.body.code ? `${reply.body.code}: ` : ''
  return `${code}${String(reply.body.message ?? reply.body.error ?? `HTTP ${reply.httpStatus}`)}`.slice(0, 400)
}

async function setSetting(supabase: Client, key: string, value: string) {
  await supabase.from('site_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key)
}

/** Atomically take a throttle slot stored in site_settings; false if another run took it recently. */
async function claimInterval(supabase: Client, key: string, intervalMs: number) {
  const now = new Date()
  const { data } = await supabase
    .from('site_settings')
    .update({ value: now.toISOString(), updated_at: now.toISOString() })
    .eq('key', key)
    .lt('value', new Date(now.getTime() - intervalMs).toISOString())
    .select('key')
  return Boolean(data?.length)
}

async function closeLane(supabase: Client, note: string) {
  await setSetting(supabase, 'mashup_lane_open', 'false')
  await setSetting(supabase, 'mashup_lane_note', note.slice(0, 300))
  await setSetting(supabase, 'mashup_lane_checked_at', new Date().toISOString())
}

function apiKeyOf(settings: Settings) {
  return (settings.mashup_api_key || '').trim()
}

/**
 * Read DataMart's catalogue (prices are for our account tier) and wallet balance.
 * New packages are added at cost price so nothing sells at a loss; admins set the margin.
 */
export async function syncMashupCatalog(supabase: Client, settings: Settings) {
  const apiKey = apiKeyOf(settings)
  if (!apiKey) return { success: false, error: 'MashUp API key is not set' }

  const reply = await datamart(apiKey, 'GET', '/mashup/packages')
  if (reply.httpStatus !== 200 || reply.body.status !== 'success' || !Array.isArray(reply.body.data)) {
    const error = replyMessage(reply)
    if (reply.httpStatus && reply.httpStatus < 500) await closeLane(supabase, error)
    return { success: false, error, code: reply.body.code ?? null }
  }

  const items = reply.body.data as Array<Record<string, unknown>>
  const now = new Date().toISOString()
  const { data: existingRows } = await supabase.from('mashup_packages').select('id, combo_cost, price, active')
  const existing = new Map((existingRows ?? []).map((r) => [Number(r.combo_cost), r]))
  const seen = new Set<number>()

  for (const item of items) {
    const comboCost = Number(item.comboCost)
    const costPrice = Number(item.price)
    if (!Number.isFinite(comboCost) || !Number.isFinite(costPrice)) continue
    seen.add(comboCost)
    const fields = {
      title: String(item.title ?? `MTN MashUp ${comboCost}`),
      cost_price: costPrice,
      mb: Number(item.mb ?? 0),
      capacity: Number(item.capacity ?? 0),
      onnet_mins: Number(item.onnetMins ?? 0),
      offnet_mins: Number(item.offnetMins ?? 0),
      sms: Number(item.sms ?? 0),
      validity_days: Number(item.validityDays ?? 30),
      available: true,
      synced_at: now,
      updated_at: now,
    }
    if (existing.has(comboCost)) {
      await supabase.from('mashup_packages').update(fields).eq('combo_cost', comboCost)
    } else {
      await supabase.from('mashup_packages').insert({ ...fields, combo_cost: comboCost, price: costPrice, active: true })
    }
  }

  const missing = [...existing.keys()].filter((c) => !seen.has(c))
  if (missing.length) {
    await supabase.from('mashup_packages').update({ available: false, updated_at: now }).in('combo_cost', missing)
  }

  const balanceReply = await datamart(apiKey, 'GET', '/balance')
  const balanceData = (balanceReply.body.data ?? {}) as Record<string, unknown>
  const balance = balanceReply.httpStatus === 200 ? Number(balanceData.balance) : NaN
  const cheapest = Math.min(...items.map((i) => Number(i.price)).filter(Number.isFinite))
  const open = reply.body.open !== false
  const funded = !Number.isFinite(balance) || !Number.isFinite(cheapest) || balance >= cheapest

  await setSetting(supabase, 'mashup_pricing_tier', String(reply.body.pricingTier ?? ''))
  await setSetting(supabase, 'mashup_catalog_synced_at', now)
  await setSetting(supabase, 'mashup_lane_checked_at', now)
  if (Number.isFinite(balance)) await setSetting(supabase, 'mashup_provider_balance', balance.toFixed(2))
  await setSetting(supabase, 'mashup_lane_open', open && funded ? 'true' : 'false')
  await setSetting(
    supabase,
    'mashup_lane_note',
    !open ? 'DataMart closed the MashUp lane' : !funded ? `DataMart wallet (GHS ${balance.toFixed(2)}) is below the cheapest package` : '',
  )

  return {
    success: true,
    packages: items.length,
    removed: missing.length,
    pricing_tier: reply.body.pricingTier ?? null,
    lane_open: open && funded,
    provider_open: open,
    provider_balance: Number.isFinite(balance) ? balance : null,
  }
}

async function submitMashupOrder(supabase: Client, settings: Settings, order: MashupOrder) {
  const meta = order.utility_meta ?? {}
  const comboCost = Number(meta.combo_cost)
  const apiKey = apiKeyOf(settings)

  const { data: claimed } = await supabase
    .from('orders')
    .update({
      provider_submitted_at: new Date().toISOString(),
      provider_status: 'submitting',
      provider_name: 'DataMart MashUp',
      provider_type: 'datamart',
      provider_error: null,
    })
    .eq('id', order.id)
    .eq('service_type', 'mashup')
    .is('provider_submitted_at', null)
    .neq('status', 'failed')
    .select(ORDER_COLUMNS)
    .maybeSingle()
  if (!claimed) return { order_id: order.id, skipped: true, reason: 'Already claimed' }
  const current = claimed as MashupOrder

  if (!apiKey || !Number.isFinite(comboCost)) {
    const reason = !apiKey ? 'MashUp API key is not set' : 'Order has no MashUp package'
    await supabase.rpc('refund_mashup_order', { p_order_id: order.id, p_reason: reason })
    return { order_id: order.id, success: false, refunded: true, error: reason }
  }

  const round = current.provider_route_round ?? 0
  const providerRef = round > 0 ? `${current.reference}-R${round}` : current.reference
  const reply = await datamart(apiKey, 'POST', '/mashup/purchase', {
    phoneNumber: current.phone,
    comboCost,
    ref: providerRef,
  })
  const data = (reply.body.data ?? {}) as Record<string, unknown>
  const code = String(reply.body.code ?? '')

  if (reply.httpStatus && reply.httpStatus >= 200 && reply.httpStatus < 300 && reply.body.status === 'success' && data.reference) {
    await supabase
      .from('orders')
      .update({
        provider_status: 'submitted',
        provider_reference: String(data.reference),
        provider_order_number: data.orderId ? String(data.orderId) : null,
        status: current.status === 'pending' ? 'processing' : current.status,
        utility_meta: {
          ...meta,
          datamart: { orderId: data.orderId ?? null, reference: data.reference, price: data.price ?? null },
        },
      })
      .eq('id', order.id)
    if (data.balanceAfter != null) await setSetting(supabase, 'mashup_provider_balance', Number(data.balanceAfter).toFixed(2))
    return { order_id: order.id, reference: current.reference, success: true, provider_reference: data.reference }
  }

  if (reply.httpStatus === 429) {
    await supabase
      .from('orders')
      .update({ provider_submitted_at: null, provider_status: null, provider_error: 'DataMart rate limit, will retry' })
      .eq('id', order.id)
    return { order_id: order.id, success: false, retry_later: true }
  }

  const message = replyMessage(reply)
  const definite =
    REJECT_CODES.has(code) ||
    (reply.httpStatus != null && [400, 401, 403, 404, 422].includes(reply.httpStatus) && code !== 'DUPLICATE_REFERENCE')

  if (definite) {
    if (LANE_CLOSING_CODES.has(code) || reply.httpStatus === 401) await closeLane(supabase, message)
    if (code === 'UNKNOWN_PACKAGE') {
      await supabase.from('mashup_packages').update({ available: false }).eq('combo_cost', comboCost)
    }
    await supabase.rpc('refund_mashup_order', { p_order_id: order.id, p_reason: `DataMart refused: ${message}` })
    return { order_id: order.id, success: false, refunded: true, error: message }
  }

  // Timeout, 5xx or a duplicate reference: the order may exist at DataMart. Keep our own
  // reference so the status sync can still find it, and never re-send automatically.
  await supabase
    .from('orders')
    .update({
      provider_status: 'uncertain',
      provider_reference: providerRef,
      provider_error: `Unclear response from DataMart — not refunded or re-sent. Check DataMart for ${providerRef}. ${message}`,
    })
    .eq('id', order.id)
  return { order_id: order.id, success: false, uncertain: true, error: message }
}

async function syncMashupStatuses(supabase: Client, settings: Settings) {
  const apiKey = apiKeyOf(settings)
  if (!apiKey) return { skipped: 'no key' }
  if (!(await claimInterval(supabase, 'mashup_status_sync_last_at', STATUS_SYNC_INTERVAL_MS))) {
    return { skipped: 'ran recently' }
  }

  const { data: rows } = await supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('service_type', 'mashup')
    .in('provider_status', ['submitted', 'pending', 'waiting', 'processing', 'uncertain'])
    .neq('status', 'failed')
    .not('provider_reference', 'is', null)
    .gte('provider_submitted_at', new Date(Date.now() - STATUS_SYNC_MAX_AGE_MS).toISOString())
    .order('provider_submitted_at', { ascending: true })
    .limit(25)

  const results = []
  for (const order of (rows ?? []) as MashupOrder[]) {
    const reply = await datamart(apiKey, 'GET', `/order-status/${encodeURIComponent(order.provider_reference!)}`)
    const data = (reply.body.data ?? {}) as Record<string, unknown>
    const raw = String(data.orderStatus ?? '').toLowerCase()
    if (reply.httpStatus !== 200 || !raw) {
      results.push({ order_id: order.id, unchanged: true, error: replyMessage(reply) })
      continue
    }

    if (raw === 'completed') {
      await supabase
        .from('orders')
        .update({
          provider_status: 'delivered',
          provider_error: null,
          status: 'completed',
          completed_at: order.status === 'completed' ? undefined : new Date().toISOString(),
        })
        .eq('id', order.id)
        .neq('status', 'failed')
    } else if (['failed', 'refunded', 'cancelled', 'canceled'].includes(raw)) {
      await supabase.rpc('refund_mashup_order', { p_order_id: order.id, p_reason: `DataMart reported "${raw}"` })
    } else {
      await supabase
        .from('orders')
        .update({
          provider_status: raw,
          provider_error: null,
          status: order.status === 'pending' ? 'processing' : order.status,
        })
        .eq('id', order.id)
        .neq('status', 'failed')
    }
    results.push({ order_id: order.id, reference: order.reference, provider_status: raw })
  }
  return { checked: results.length, results }
}

/** When the lane was closed (not enabled, wallet empty, lane shut), re-check it at most every 15 minutes. */
async function recheckLane(supabase: Client, settings: Settings) {
  if (settings.mashup_lane_open !== 'false') return null
  if (!(await claimInterval(supabase, 'mashup_lane_checked_at', LANE_RECHECK_MS))) return null
  return syncMashupCatalog(supabase, settings)
}

export async function processMashup(supabase: Client, settings: Settings) {
  if (settings.mashup_enabled !== 'true') return { skipped: 'MashUp disabled' }

  const lane = await recheckLane(supabase, settings)
  const laneOpen = lane ? lane.success && lane.lane_open : settings.mashup_lane_open !== 'false'

  const submitted = []
  if (!laneOpen) {
    submitted.push(...(await refundStaleWhileClosed(supabase, settings)))
  } else {
    const { data: pending } = await supabase.rpc('get_orders_pending_mashup', { p_limit: 20 })
    for (const order of (pending ?? []) as MashupOrder[]) {
      submitted.push(await submitMashupOrder(supabase, settings, order))
      if (submitted.at(-1)?.refunded && (await laneClosed(supabase))) break
    }
  }

  const statuses = await syncMashupStatuses(supabase, settings)
  return { lane_open: laneOpen, lane_check: lane, submitted, statuses }
}

/** Orders placed just before the lane closed must not wait forever; refund them after 30 minutes. */
async function refundStaleWhileClosed(supabase: Client, settings: Settings) {
  const { data: pending } = await supabase.rpc('get_orders_pending_mashup', { p_limit: 20 })
  const cutoff = Date.now() - 30 * 60_000
  const results = []
  for (const order of (pending ?? []) as Array<MashupOrder & { created_at: string }>) {
    if (Date.parse(order.created_at) > cutoff) continue
    const { data: claimed } = await supabase
      .from('orders')
      .update({ provider_submitted_at: new Date().toISOString(), provider_status: 'submitting' })
      .eq('id', order.id)
      .is('provider_submitted_at', null)
      .select('id')
      .maybeSingle()
    if (!claimed) continue
    const reason = `MTN MashUp unavailable: ${settings.mashup_lane_note || 'DataMart lane closed'}`
    await supabase.rpc('refund_mashup_order', { p_order_id: order.id, p_reason: reason })
    results.push({ order_id: order.id, success: false, refunded: true, error: reason })
  }
  return results
}

async function laneClosed(supabase: Client) {
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'mashup_lane_open').maybeSingle()
  return data?.value === 'false'
}

export async function processMashupOrder(supabase: Client, settings: Settings, orderId: string) {
  if (settings.mashup_enabled !== 'true') return { order_id: orderId, skipped: true, reason: 'MashUp disabled' }
  const { data } = await supabase.from('orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle()
  if (!data) return { order_id: orderId, skipped: true, reason: 'Order not found' }
  if (settings.mashup_lane_open === 'false') {
    return { order_id: orderId, skipped: true, reason: 'MashUp lane closed; the order waits for the next check' }
  }
  return submitMashupOrder(supabase, settings, data as MashupOrder)
}
