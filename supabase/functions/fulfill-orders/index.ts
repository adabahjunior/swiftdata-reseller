import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DATAHUB_BASE = 'https://user.datahubgh.com/api/external'
const SKPLUG_BASE = 'https://skdataplug.com/api/v1'
const DATAMART_BASE = 'https://api.datamartgh.shop/api/developer'
const BUNDLEZONE_BASE = 'https://bundlezone.shop/api'
const SPENDLESS_BASE = 'https://spendless.top/api'
const REQUEST_TIMEOUT_MS = 25_000

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

/** Our DB network → DataMart GH network */
const DATAMART_NETWORK_MAP: Record<string, string> = {
  mtn: 'YELLO',
  at_ishare: 'AT_PREMIUM',
  at_bigtime: 'at',
  telecel: 'TELECEL',
}

/** Our DB network → BundleZone network (exact values from /api/bundles.php) */
const BUNDLEZONE_NETWORK_MAP: Record<string, string> = {
  mtn: 'YELLO',
  at_ishare: 'AT',
  at_bigtime: 'AIRTELTIGO B',
  telecel: 'TELECEL',
}

/** Our DB network → Spendless networkKey */
const SPENDLESS_NETWORK_MAP: Record<string, string> = {
  mtn: 'YELLO',
  at_ishare: 'AT_PREMIUM',
  at_bigtime: 'AT_BIGTIME',
  telecel: 'TELECEL',
}

/** BundleZone codes documented as "no order was created and no charge was made". */
const BUNDLEZONE_NO_ORDER_CODES = new Set([
  'BENEFICIARY_NOT_VERIFIED',
  'INVALID_PHONE_NUMBER',
  'VERIFICATION_PENDING',
  'VERIFICATION_UNAVAILABLE',
  'BULK_VERIFICATION_HELD',
  'ORDER_SERVICE_UNAVAILABLE',
  'ORDER_REJECTED',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
])

const PROVIDER_SLUGS = ['primary', 'secondary', 'tertiary', 'quaternary', 'quinary'] as const

const SLOT_DEFAULT_TYPE: Record<ProviderSlug, ProviderType> = {
  primary: 'datahub',
  secondary: 'skplug',
  tertiary: 'datahub',
  quaternary: 'bundlezone',
  quinary: 'spendless',
}

type OrderRow = {
  id: string
  reference: string
  phone: string
  network: string
  size_gb: number
  status: string
  provider_submitted_at: string | null
  provider_route_round?: number | null
  provider_attempts?: number | null
}

type ProviderSlug = (typeof PROVIDER_SLUGS)[number]
type ProviderType = 'datahub' | 'skplug' | 'datamart' | 'bundlezone' | 'spendless'

type ActiveProvider = {
  slug: ProviderSlug
  type: ProviderType
  name: string
  apiKey: string
}

/**
 * accepted  — provider took the order.
 * rejected  — provider confirmed nothing was created; safe to try the next provider.
 * uncertain — the order may exist at the provider; never re-route automatically.
 */
type Outcome = 'accepted' | 'rejected' | 'uncertain'

type PurchaseResult = {
  outcome: Outcome
  httpStatus: number | null
  providerRef: string | null
  providerOrderNo: string | null
  error: string | null
  raw: Record<string, unknown>
}

type HttpReply = {
  status: number | null
  body: Record<string, unknown>
  parsed: boolean
  networkError: string | null
}

type AttemptRow = {
  provider_slot: string
  provider_name: string
  attempt_no: number
  outcome: string
  error: string | null
}

const ORDER_CLAIM_COLUMNS =
  'id, reference, phone, network, size_gb, status, provider_submitted_at, provider_route_round, provider_attempts'

function normalizeProviderType(raw: string | undefined, fallback: ProviderType): ProviderType {
  const t = (raw ?? fallback).trim().toLowerCase()
  if (t === 'skplug' || t === 'datamart' || t === 'datahub' || t === 'bundlezone' || t === 'spendless') return t
  return fallback
}

function defaultProviderName(type: ProviderType, slug: ProviderSlug) {
  if (type === 'skplug') return 'SK Plug'
  if (type === 'datamart') return 'DataMart GH'
  if (type === 'bundlezone') return 'BundleZone'
  if (type === 'spendless') return 'Spendless'
  return slug === 'primary' ? 'Primary Datahub' : 'Datahub'
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseSlug(raw: string | undefined | null): ProviderSlug | null {
  const s = (raw ?? '').trim().toLowerCase()
  return (PROVIDER_SLUGS as readonly string[]).includes(s) ? (s as ProviderSlug) : null
}

function providerForSlug(
  settingsMap: Record<string, string>,
  slug: ProviderSlug,
  envFallback?: string | null,
): ActiveProvider {
  const type = normalizeProviderType(settingsMap[`data_provider_${slug}_type`], SLOT_DEFAULT_TYPE[slug])
  const slotKey = settingsMap[`data_provider_${slug}_api_key`]?.trim() || ''
  return {
    slug,
    type,
    name: settingsMap[`data_provider_${slug}_name`]?.trim() || defaultProviderName(type, slug),
    apiKey: slotKey || (type === 'datahub' ? envFallback?.trim() || '' : ''),
  }
}

function getActiveProvider(settingsMap: Record<string, string>, envFallback?: string | null) {
  return providerForSlug(settingsMap, parseSlug(settingsMap.active_data_provider) ?? 'primary', envFallback)
}

function isRerouteEnabled(settingsMap: Record<string, string>) {
  return settingsMap.provider_auto_reroute_enabled !== 'false'
}

/** Active provider first, then the configured fallback order. Slots without a key are skipped. */
function getProviderChain(settingsMap: Record<string, string>, envFallback?: string | null) {
  const active = parseSlug(settingsMap.active_data_provider) ?? 'primary'
  if (!isRerouteEnabled(settingsMap)) {
    const provider = providerForSlug(settingsMap, active, envFallback)
    return provider.apiKey ? [provider] : []
  }
  const configured = (settingsMap.provider_reroute_chain || PROVIDER_SLUGS.join(','))
    .split(',')
    .map(parseSlug)
    .filter((s): s is ProviderSlug => s !== null)
  const order = [...new Set([active, ...configured])]
  return order
    .map((slug) => providerForSlug(settingsMap, slug, envFallback))
    .filter((p) => p.apiKey)
}

async function sendJson(
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown },
): Promise<HttpReply> {
  try {
    const res = await fetch(url, {
      method: init.method ?? 'POST',
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await res.text()
    try {
      const parsed = JSON.parse(text)
      return {
        status: res.status,
        body: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed },
        parsed: true,
        networkError: null,
      }
    } catch {
      return { status: res.status, body: { raw: text.slice(0, 500) }, parsed: false, networkError: null }
    }
  } catch (e) {
    return { status: null, body: {}, parsed: false, networkError: (e as Error).message || 'Network error' }
  }
}

/** Generic HTTP classification when the provider gives no explicit accept/reject signal. */
function classifyReply(reply: HttpReply, explicitFailure: boolean): Outcome {
  if (reply.networkError || reply.status === null) return 'uncertain'
  const s = reply.status
  if (s === 429) return 'rejected'
  if (s === 408 || s === 409 || s >= 500) return 'uncertain'
  if (s >= 400) return 'rejected'
  if (reply.parsed && explicitFailure) return 'rejected'
  return 'uncertain'
}

function replyError(reply: HttpReply, message: unknown, fallback: string) {
  if (reply.networkError) return `Network error: ${reply.networkError}`
  const text = message == null || message === '' ? '' : String(message)
  return text || `${fallback} (HTTP ${reply.status})`
}

async function datahubPurchase(
  apiKey: string,
  payload: { networkKey: string; recipient: string; capacity: number; reference: string },
): Promise<PurchaseResult> {
  const reply = await sendJson(`${DATAHUB_BASE}/data-purchase`, {
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: payload,
  })
  const body = reply.body
  const data = (body.data ?? {}) as Record<string, unknown>
  const accepted = reply.parsed && body.success === true && (reply.status ?? 0) < 400
  const outcome = accepted ? 'accepted' : classifyReply(reply, body.success === false)
  return {
    outcome,
    httpStatus: reply.status,
    providerRef: String(data.reference ?? body.reference ?? data.orderReference ?? '') || null,
    providerOrderNo: String(data.orderNumber ?? body.orderNumber ?? data.orderNo ?? '') || null,
    error: accepted ? null : replyError(reply, body.error ?? body.message, 'Datahub rejected order'),
    raw: body,
  }
}

async function skplugPurchase(
  token: string,
  payload: { recipient: string; network: string; gb_size: string },
): Promise<PurchaseResult> {
  const reply = await sendJson(`${SKPLUG_BASE}/order/`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: payload,
  })
  const body = reply.body
  const data = (body.data ?? {}) as Record<string, unknown>
  const orderId = body.order_id ?? body.orderId ?? data.order_id ?? body.id ?? null
  const status = String(body.status ?? data.status ?? '').toLowerCase()
  const ok2xx = reply.status !== null && reply.status >= 200 && reply.status < 300
  const accepted = ok2xx && Boolean(orderId) && status !== 'failed' && !body.error && body.success !== false
  const explicitFailure = status === 'failed' || Boolean(body.error) || body.success === false
  const outcome = accepted ? 'accepted' : classifyReply(reply, explicitFailure)
  return {
    outcome,
    httpStatus: reply.status,
    providerRef: orderId ? String(orderId) : null,
    providerOrderNo: orderId ? String(orderId) : null,
    error: accepted
      ? null
      : replyError(reply, body.error ?? body.message ?? body.detail, 'SK Plug rejected order'),
    raw: body,
  }
}

async function datamartPurchase(
  apiKey: string,
  payload: { phoneNumber: string; network: string; capacity: string; gateway: string; ref: string },
): Promise<PurchaseResult> {
  const reply = await sendJson(`${DATAMART_BASE}/purchase`, {
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: payload,
  })
  const body = reply.body
  const data = (body.data ?? {}) as Record<string, unknown>
  const orderRef = data.orderReference ?? data.reference ?? data.ref ?? body.orderReference ?? body.reference ?? null
  const status = String(data.status ?? '').toLowerCase()
  const ok2xx = reply.status !== null && reply.status >= 200 && reply.status < 300
  const accepted =
    ok2xx &&
    (body.status === 'success' || body.success === true) &&
    status !== 'failed' &&
    status !== 'error'
  const explicitFailure =
    body.status === 'error' || body.status === 'failed' || body.success === false || status === 'failed'
  const outcome = accepted ? 'accepted' : classifyReply(reply, explicitFailure)
  return {
    outcome,
    httpStatus: reply.status,
    providerRef: orderRef ? String(orderRef) : payload.ref,
    providerOrderNo: orderRef ? String(orderRef) : null,
    error: accepted
      ? null
      : replyError(reply, body.message ?? body.error ?? data.message, 'DataMart rejected order'),
    raw: body,
  }
}

async function bundlezonePurchase(
  apiKey: string,
  payload: { network: string; recipient: string; capacity: number },
): Promise<PurchaseResult> {
  const reply = await sendJson(`${BUNDLEZONE_BASE}/order.php`, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: { mode: 'single', ...payload },
  })
  const body = reply.body
  const data = (body.data ?? {}) as Record<string, unknown>
  const order = (data.order ?? {}) as Record<string, unknown>
  const orderStatus = String(order.status ?? '').toLowerCase()
  const code = String(order.code ?? data.code ?? body.code ?? '')
  const ok2xx = reply.status !== null && reply.status >= 200 && reply.status < 300

  let outcome: Outcome
  if (ok2xx && body.success === true && order.success !== false && orderStatus !== 'failed') {
    outcome = 'accepted'
  } else if (code === 'ORDER_ALREADY_PENDING') {
    outcome = 'uncertain'
  } else if (order.order_created === false || BUNDLEZONE_NO_ORDER_CODES.has(code)) {
    outcome = 'rejected'
  } else {
    outcome = classifyReply(reply, body.success === false)
  }

  const reference = order.reference ?? data.reference ?? null
  const orderId = order.order_id ?? order.id ?? data.order_id ?? null
  const message = replyError(reply, body.message ?? order.message, 'BundleZone rejected order')
  return {
    outcome,
    httpStatus: reply.status,
    providerRef: reference ? String(reference) : null,
    providerOrderNo: orderId ? String(orderId) : null,
    error: outcome === 'accepted' ? null : code ? `${code}: ${message}` : message,
    raw: body,
  }
}

async function spendlessPurchase(
  apiKey: string,
  payload: { networkKey: string; recipient: string; capacity: number; webhook_url?: string },
): Promise<PurchaseResult> {
  const reply = await sendJson(`${SPENDLESS_BASE}/purchase`, {
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: payload,
  })
  const body = reply.body
  const data = (body.data ?? {}) as Record<string, unknown>
  const reference = data.reference ?? null
  const orderId = data.orderId ?? data.order_id ?? null
  const orderStatus = String(data.status ?? '').toLowerCase()
  const ok2xx = reply.status !== null && reply.status >= 200 && reply.status < 300
  const explicitFailure = body.status === 'error' || body.status === 'failed' || orderStatus === 'failed'

  let outcome: Outcome
  if (ok2xx && body.status === 'success' && Boolean(reference || orderId) && orderStatus !== 'failed') {
    outcome = 'accepted'
  } else if (reply.status === 503 && body.status === 'error' && /disabled/i.test(String(body.message ?? ''))) {
    // Spendless answers 503 "endpoint is currently disabled" before any order is created.
    outcome = 'rejected'
  } else {
    outcome = classifyReply(reply, explicitFailure)
  }

  return {
    outcome,
    httpStatus: reply.status,
    providerRef: reference ? String(reference) : null,
    providerOrderNo: orderId ? String(orderId) : null,
    error: outcome === 'accepted' ? null : replyError(reply, body.message ?? body.error, 'Spendless rejected order'),
    raw: body,
  }
}

function spendlessWebhookUrl() {
  const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/sync-provider-status/provider-webhook/spendless` : undefined
}

async function purchaseWithProvider(
  provider: ActiveProvider,
  order: OrderRow,
  mtnNetworkKey: string,
): Promise<PurchaseResult> {
  if (provider.type === 'spendless') {
    return spendlessPurchase(provider.apiKey, {
      networkKey: SPENDLESS_NETWORK_MAP[order.network] ?? order.network.toUpperCase(),
      recipient: order.phone,
      capacity: Number(order.size_gb),
      webhook_url: spendlessWebhookUrl(),
    })
  }

  if (provider.type === 'bundlezone') {
    return bundlezonePurchase(provider.apiKey, {
      network: BUNDLEZONE_NETWORK_MAP[order.network] ?? order.network.toUpperCase(),
      recipient: order.phone,
      capacity: Number(order.size_gb),
    })
  }

  if (provider.type === 'skplug') {
    return skplugPurchase(provider.apiKey, {
      recipient: order.phone,
      network: SKPLUG_NETWORK_MAP[order.network] ?? order.network.toUpperCase(),
      gb_size: String(Number(order.size_gb)),
    })
  }

  if (provider.type === 'datamart') {
    return datamartPurchase(provider.apiKey, {
      phoneNumber: order.phone,
      network: DATAMART_NETWORK_MAP[order.network] ?? order.network.toUpperCase(),
      capacity: String(Number(order.size_gb)),
      gateway: 'wallet',
      ref: order.reference,
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
  if (provider.type === 'spendless') {
    const reply = await sendJson(`${SPENDLESS_BASE}/balance`, {
      method: 'GET',
      headers: { 'X-API-Key': provider.apiKey, Accept: 'application/json' },
    })
    return { ok: reply.status === 200 && reply.body.status === 'success', body: reply.body }
  }

  if (provider.type === 'bundlezone') {
    const reply = await sendJson(`${BUNDLEZONE_BASE}/balance.php`, {
      method: 'GET',
      headers: { 'x-api-key': provider.apiKey, Accept: 'application/json' },
    })
    return { ok: reply.status === 200 && reply.body.success === true, body: reply.body }
  }

  if (provider.type === 'skplug') {
    const reply = await sendJson(`${SKPLUG_BASE}/bundles/`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${provider.apiKey}` },
    })
    return { ok: reply.status === 200, body: reply.body }
  }

  if (provider.type === 'datamart') {
    const reply = await sendJson(`${DATAMART_BASE}/balance`, {
      method: 'GET',
      headers: { 'X-API-Key': provider.apiKey },
    })
    return { ok: reply.status === 200 && reply.body.status === 'success', body: reply.body }
  }

  const reply = await sendJson(`${DATAHUB_BASE}/balance`, {
    method: 'GET',
    headers: { 'X-API-Key': provider.apiKey },
  })
  return { ok: reply.status === 200, body: reply.body }
}

/**
 * Atomically claim an order before calling any provider.
 * Prevents duplicate purchases when /order/{id} and /process race.
 */
async function claimOrder(supabase: ReturnType<typeof createClient>, orderId: string) {
  const { data, error } = await supabase
    .from('orders')
    .update({
      provider_submitted_at: new Date().toISOString(),
      provider_status: 'submitting',
      provider_error: null,
    })
    .eq('id', orderId)
    .is('provider_submitted_at', null)
    .select(ORDER_CLAIM_COLUMNS)
    .maybeSingle()

  if (error) throw error
  return data as OrderRow | null
}

/** Record the attempt before calling the provider; the unique key blocks a second send to the same slot. */
async function openAttempt(
  supabase: ReturnType<typeof createClient>,
  order: OrderRow,
  round: number,
  attemptNo: number,
  provider: ActiveProvider,
) {
  const { data, error } = await supabase
    .from('order_provider_attempts')
    .upsert(
      {
        order_id: order.id,
        route_round: round,
        attempt_no: attemptNo,
        provider_slot: provider.slug,
        provider_type: provider.type,
        provider_name: provider.name,
        outcome: 'submitting',
      },
      { onConflict: 'order_id,route_round,provider_slot', ignoreDuplicates: true },
    )
    .select('id')
  if (error) throw error
  return (data?.[0]?.id as string | undefined) ?? null
}

async function fulfillOrder(
  supabase: ReturnType<typeof createClient>,
  chain: ActiveProvider[],
  order: OrderRow,
  mtnNetworkKey: string,
) {
  if (order.provider_submitted_at) {
    return { order_id: order.id, skipped: true, reason: 'Already submitted' }
  }

  const claimed = await claimOrder(supabase, order.id)
  if (!claimed) {
    return { order_id: order.id, skipped: true, reason: 'Already claimed by another worker' }
  }

  const round = claimed.provider_route_round ?? 0
  const { data: priorRows, error: priorError } = await supabase
    .from('order_provider_attempts')
    .select('provider_slot, provider_name, attempt_no, outcome, error')
    .eq('order_id', claimed.id)
    .eq('route_round', round)
    .order('attempt_no', { ascending: true })
  if (priorError) throw priorError

  const prior = (priorRows as AttemptRow[]) ?? []
  const tried = new Set(prior.map((a) => a.provider_slot))
  const failures = prior
    .filter((a) => a.outcome === 'rejected' || a.outcome === 'failed_later')
    .map((a) => `${a.provider_name}: ${a.error ?? a.outcome}`)
  let attemptNo = prior.reduce((max, a) => Math.max(max, a.attempt_no), claimed.provider_attempts ?? 0)
  const attempts: Array<Record<string, unknown>> = []

  for (const provider of chain.filter((p) => !tried.has(p.slug))) {
    attemptNo += 1
    const attemptId = await openAttempt(supabase, claimed, round, attemptNo, provider)
    if (!attemptId) {
      attemptNo -= 1
      continue
    }

    await supabase
      .from('orders')
      .update({
        provider_status: 'submitting',
        provider_name: provider.name,
        provider_type: provider.type,
        provider_attempt_id: attemptId,
        provider_attempts: attemptNo,
        provider_error: null,
      })
      .eq('id', claimed.id)

    let result: PurchaseResult
    try {
      result = await purchaseWithProvider(provider, claimed, mtnNetworkKey)
    } catch (e) {
      result = {
        outcome: 'uncertain',
        httpStatus: null,
        providerRef: null,
        providerOrderNo: null,
        error: (e as Error).message || 'Unexpected error while calling provider',
        raw: {},
      }
    }

    await supabase
      .from('order_provider_attempts')
      .update({
        outcome: result.outcome,
        http_status: result.httpStatus,
        provider_reference: result.providerRef,
        provider_order_number: result.providerOrderNo,
        error: result.error,
        finished_at: new Date().toISOString(),
      })
      .eq('id', attemptId)

    attempts.push({ provider: provider.name, slot: provider.slug, outcome: result.outcome, error: result.error })

    if (result.outcome === 'accepted') {
      await supabase
        .from('orders')
        .update({
          provider_status: 'submitted',
          provider_reference: result.providerRef,
          provider_order_number: result.providerOrderNo,
          provider_error: null,
          status: claimed.status === 'pending' ? 'processing' : claimed.status,
        })
        .eq('id', claimed.id)
      return {
        order_id: claimed.id,
        reference: claimed.reference,
        success: true,
        provider_status: 'submitted',
        provider_name: provider.name,
        provider_type: provider.type,
        provider_reference: result.providerRef,
        rerouted: attemptNo > 1,
        attempts,
      }
    }

    if (result.outcome === 'uncertain') {
      const error = `Unclear response from ${provider.name} — not re-routed to avoid a duplicate. Check ${provider.name} before retrying. ${result.error ?? ''}`.trim()
      await supabase
        .from('orders')
        .update({
          provider_status: 'uncertain',
          provider_reference: result.providerRef,
          provider_order_number: result.providerOrderNo,
          provider_error: error,
        })
        .eq('id', claimed.id)
      return {
        order_id: claimed.id,
        reference: claimed.reference,
        success: false,
        provider_status: 'uncertain',
        provider_name: provider.name,
        provider_type: provider.type,
        error,
        attempts,
      }
    }

    failures.push(`${provider.name}: ${result.error ?? 'rejected'}`)
  }

  const hadLateFailure = prior.some((a) => a.outcome === 'failed_later')
  const error =
    failures.length > 1
      ? `All providers rejected — ${failures.join(' | ')}`
      : failures[0] ?? 'No provider with an API credential is available'
  const update: Record<string, unknown> = {
    provider_status: 'failed',
    provider_error: error,
  }
  if (hadLateFailure) {
    update.status = 'failed'
    update.failure_reason = error
  }
  await supabase.from('orders').update(update).eq('id', claimed.id)

  return {
    order_id: claimed.id,
    reference: claimed.reference,
    success: false,
    provider_status: 'failed',
    error,
    attempts,
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

  const loadSettings = async () => {
    const { data: settings } = await supabase.from('site_settings').select('key, value')
    return Object.fromEntries((settings ?? []).map((s) => [s.key, s.value])) as Record<string, string>
  }

  try {
    if (req.method === 'POST' && path === '/process') {
      const settingsMap = await loadSettings()

      if (settingsMap.provider_fulfillment_enabled === 'false') {
        return json({ success: true, processed: 0, message: 'Provider fulfillment disabled' })
      }

      const chain = getProviderChain(settingsMap, envFallback)
      if (chain.length === 0) {
        return json({ success: false, error: 'No provider slot has an API credential configured' }, 500)
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
        results.push(await fulfillOrder(supabase, chain, order, mtnKey))
      }

      return json({
        success: true,
        active_provider: chain[0].slug,
        provider_name: chain[0].name,
        provider_type: chain[0].type,
        reroute_enabled: isRerouteEnabled(settingsMap),
        chain: chain.map((p) => p.slug),
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

      const settingsMap = await loadSettings()
      const chain = getProviderChain(settingsMap, envFallback)
      if (chain.length === 0) {
        return json({ success: false, error: 'No provider slot has an API credential configured' }, 500)
      }

      const mtnKey = settingsMap.provider_mtn_network_key || 'YELLO'

      const { data: order, error } = await supabase
        .from('orders')
        .select(ORDER_CLAIM_COLUMNS)
        .eq('id', orderId)
        .maybeSingle()

      if (error || !order) {
        return json({ success: false, error: 'Order not found' }, 404)
      }

      const result = await fulfillOrder(supabase, chain, order as OrderRow, mtnKey)
      return json({
        success: true,
        active_provider: chain[0].slug,
        provider_name: chain[0].name,
        provider_type: chain[0].type,
        chain: chain.map((p) => p.slug),
        result,
      })
    }

    if (req.method === 'GET' && path === '/health') {
      const settingsMap = await loadSettings()
      const slot = parseSlug(url.searchParams.get('slot'))
      const provider = slot
        ? providerForSlug(settingsMap, slot, envFallback)
        : getActiveProvider(settingsMap, envFallback)

      if (!provider.apiKey) {
        return json({
          success: false,
          error: `No API credential configured for ${provider.slug} provider`,
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
        'POST /process':
          'Submit pending orders to the active provider, auto re-routing definite rejections to the next provider slot',
        'POST /order/{id}': 'Submit one order (same re-routing rules)',
        'GET /health?slot=': 'Check the active provider, or a specific slot (primary/secondary/tertiary/quaternary/quinary)',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
