import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-datahub-signature, x-webhook-signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DATAMART_BASE = 'https://api.datamartgh.shop/api/developer'
const DATAHUB_BASE = 'https://user.datahubgh.com/api/external'
/** MTN Ghana prefixes used by Datahub / DataMart verify. */
const MTN_PREFIX_RE = /^0(24|25|53|54|55)\d{7}$/
const PHONE_RE = /^0[2-5]\d{8}$/

type ProviderSlug = 'primary' | 'secondary' | 'tertiary'
type ProviderCred = {
  slug: ProviderSlug
  name: string
  apiKey: string
}

export type CheckResult = {
  phone: string
  valid: boolean
  verified: boolean
  servable: boolean | null
  recommendation: 'sell_any' | 'activate_first' | null
  status: 'verified' | 'unverified' | 'invalid' | 'error' | 'pending' | 'submitted'
  message: string
  provider_exists: boolean | null
  provider_name: string | null
  network: string | null
  cached: boolean | null
  submitted_to_provider?: boolean
  record_id?: string
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizePhone(raw: string): string {
  let phone = String(raw ?? '').trim().replace(/[\s\-()]/g, '')
  if (phone.startsWith('+233')) phone = `0${phone.slice(4)}`
  else if (phone.startsWith('233') && phone.length >= 12) phone = `0${phone.slice(3)}`
  else if (/^[2-5]\d{8}$/.test(phone)) phone = `0${phone}`
  return phone
}

function isMtn(phone: string) {
  return MTN_PREFIX_RE.test(phone)
}

function providerSlots(settingsMap: Record<string, string>) {
  return [
    {
      slug: 'primary' as const,
      type: (settingsMap.data_provider_primary_type || '').trim().toLowerCase(),
      name: settingsMap.data_provider_primary_name?.trim() || 'Primary',
      apiKey: settingsMap.data_provider_primary_api_key?.trim() || '',
    },
    {
      slug: 'secondary' as const,
      type: (settingsMap.data_provider_secondary_type || '').trim().toLowerCase(),
      name: settingsMap.data_provider_secondary_name?.trim() || 'Secondary',
      apiKey: settingsMap.data_provider_secondary_api_key?.trim() || '',
    },
    {
      slug: 'tertiary' as const,
      type: (settingsMap.data_provider_tertiary_type || 'datahub').trim().toLowerCase(),
      name: settingsMap.data_provider_tertiary_name?.trim() || 'Datahub',
      apiKey: settingsMap.data_provider_tertiary_api_key?.trim() || '',
    },
  ]
}

function getDatahubProvider(settingsMap: Record<string, string>): ProviderCred | null {
  const slots = providerSlots(settingsMap)
  const tertiary = slots.find((s) => s.slug === 'tertiary' && s.type === 'datahub' && s.apiKey)
  const any = slots.find((s) => s.type === 'datahub' && s.apiKey)
  const picked = tertiary ?? any
  if (picked) return { slug: picked.slug, name: picked.name || 'Datahub', apiKey: picked.apiKey }
  const envKey = Deno.env.get('DATAHUB_API_KEY')?.trim() || ''
  if (envKey) return { slug: 'tertiary', name: 'Datahub', apiKey: envKey }
  return null
}

function getDatamartProvider(settingsMap: Record<string, string>): ProviderCred | null {
  const slots = providerSlots(settingsMap)
  const slot = slots.find((s) => s.type === 'datamart' && s.apiKey)
  if (slot) return { slug: slot.slug, name: slot.name || 'DataMart GH', apiKey: slot.apiKey }
  const dedicated = settingsMap.datamart_api_key?.trim() || ''
  if (dedicated) {
    return {
      slug: 'primary',
      name: settingsMap.datamart_name?.trim() || 'DataMart GH',
      apiKey: dedicated,
    }
  }
  return null
}

async function datahubVerifySingle(apiKey: string, phone: string, isPorted = false) {
  const res = await fetch(`${DATAHUB_BASE}/purchases/verify-number`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phone, is_ported_number: isPorted }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body: body as Record<string, unknown> }
}

async function datahubSubmitNumbers(apiKey: string, phones: string[]) {
  const unique = [...new Set(phones.map(normalizePhone).filter(isMtn))]
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30))

  const summaries: Array<Record<string, unknown>> = []
  for (const chunk of chunks) {
    const res = await fetch(`${DATAHUB_BASE}/purchases/submit-numbers`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ numbers: chunk }),
    })
    const body = await res.json().catch(() => ({}))
    summaries.push({
      ok: res.ok,
      status: res.status,
      submitted: Boolean((body as Record<string, unknown>)?.success),
      body,
    })
  }
  return summaries
}

async function datamartVerifySingle(apiKey: string, phone: string) {
  const res = await fetch(`${DATAMART_BASE}/verify-number`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phoneNumber: phone }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body: body as Record<string, unknown> }
}

async function datamartVerifyBulk(apiKey: string, phones: string[]) {
  const res = await fetch(`${DATAMART_BASE}/verify-number/bulk`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ numbers: phones }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body: body as Record<string, unknown> }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

function invalidResult(phone: string, message: string, providerName: string | null): CheckResult {
  return {
    phone,
    valid: false,
    verified: false,
    servable: null,
    recommendation: null,
    status: 'invalid',
    message,
    provider_exists: null,
    provider_name: providerName,
    network: null,
    cached: null,
  }
}

function interpretDatahub(
  phone: string,
  provider: ProviderCred,
  result: { ok: boolean; status: number; body: Record<string, unknown> },
): CheckResult {
  if (!PHONE_RE.test(phone)) {
    return invalidResult(phone, 'Invalid Ghana phone. Use format 0241234567', provider.name)
  }
  if (!isMtn(phone)) {
    return invalidResult(
      phone,
      'Only MTN numbers can be verified (024, 025, 053, 054, 055)',
      provider.name,
    )
  }

  const body = result.body
  const data = (body.data ?? {}) as Record<string, unknown>
  const errorText = String(body.error ?? body.message ?? '')

  if (result.status === 429 || /rate limit/i.test(errorText)) {
    return {
      phone,
      valid: true,
      verified: false,
      servable: null,
      recommendation: null,
      status: 'error',
      message: String(body.message ?? 'Too many requests — try again shortly'),
      provider_exists: null,
      provider_name: provider.name,
      network: 'MTN',
      cached: null,
    }
  }

  if (result.status === 503 || /unavailable/i.test(errorText)) {
    return {
      phone,
      valid: true,
      verified: false,
      servable: null,
      recommendation: null,
      status: 'error',
      message: String(body.message ?? 'Verification temporarily unavailable — retry shortly'),
      provider_exists: null,
      provider_name: provider.name,
      network: 'MTN',
      cached: null,
    }
  }

  const exists = data.exists === true
  if (body.success === true && exists) {
    return {
      phone,
      valid: true,
      verified: true,
      servable: true,
      recommendation: 'sell_any',
      status: 'verified',
      message: String(data.message ?? 'Number verified successfully — you may sell any bundle size.'),
      provider_exists: true,
      provider_name: provider.name,
      network: 'MTN',
      cached: null,
    }
  }

  const autoSubmitted = body.submittedToJessco === true
  return {
    phone,
    valid: true,
    verified: false,
    servable: false,
    recommendation: 'activate_first',
    status: autoSubmitted ? 'submitted' : 'unverified',
    message: String(
      body.message ??
        data.message ??
        errorText ??
        'Number is not on the beneficiary list. It has been submitted for approval.',
    ),
    provider_exists: false,
    provider_name: provider.name,
    network: 'MTN',
    cached: null,
    submitted_to_provider: autoSubmitted,
  }
}

function interpretDatamartSingle(
  phone: string,
  provider: ProviderCred,
  result: { ok: boolean; status: number; body: Record<string, unknown> },
): CheckResult {
  if (!PHONE_RE.test(phone)) {
    return invalidResult(phone, 'Invalid Ghana phone. Use format 0241234567', provider.name)
  }
  if (!isMtn(phone)) {
    return invalidResult(
      phone,
      'Only MTN numbers can be verified (024, 025, 053, 054, 055)',
      provider.name,
    )
  }

  const body = result.body
  const data = (body.data ?? {}) as Record<string, unknown>
  const code = String(body.code ?? data.code ?? '')

  if (result.status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
    const retry = body.retryAfter ?? data.retryAfter
    return {
      phone,
      valid: true,
      verified: false,
      servable: null,
      recommendation: null,
      status: 'error',
      message: retry
        ? `Too many requests — try again in ${retry}s`
        : 'Too many requests — try again shortly',
      provider_exists: null,
      provider_name: provider.name,
      network: 'MTN',
      cached: null,
    }
  }

  if (result.status === 503 || code === 'VERIFY_UNAVAILABLE') {
    return {
      phone,
      valid: true,
      verified: false,
      servable: null,
      recommendation: null,
      status: 'error',
      message: String(body.message ?? 'Verification temporarily unavailable — retry shortly'),
      provider_exists: null,
      provider_name: provider.name,
      network: 'MTN',
      cached: null,
    }
  }

  if (body.status === 'success' || result.ok) {
    const servable = Boolean(data.servable === true)
    const recommendation =
      data.recommendation === 'activate_first'
        ? 'activate_first'
        : data.recommendation === 'sell_any'
          ? 'sell_any'
          : servable
            ? 'sell_any'
            : 'activate_first'
    const message = String(
      data.message ??
        (servable
          ? 'This number can be served — you may sell any bundle size.'
          : 'This number needs activation first (sell 1GB, wait up to 72h).'),
    )
    return {
      phone: String(data.phoneNumber ?? phone),
      valid: true,
      verified: servable,
      servable,
      recommendation,
      status: servable ? 'verified' : 'unverified',
      message,
      provider_exists: servable,
      provider_name: provider.name,
      network: String(data.network ?? 'MTN'),
      cached: typeof data.cached === 'boolean' ? data.cached : null,
    }
  }

  const errMsg = String(body.message ?? body.error ?? `Verify failed (${result.status})`)
  if (/valid MTN|024|054|055|059/i.test(errMsg)) {
    return invalidResult(phone, errMsg, provider.name)
  }

  return {
    phone,
    valid: true,
    verified: false,
    servable: false,
    recommendation: 'activate_first',
    status: 'unverified',
    message: errMsg,
    provider_exists: false,
    provider_name: provider.name,
    network: 'MTN',
    cached: null,
  }
}

function interpretDatamartBulkItem(
  raw: string,
  provider: ProviderCred,
  item: Record<string, unknown> | undefined,
): CheckResult {
  const phone = normalizePhone(String(item?.normalized ?? item?.number ?? raw))
  if (!PHONE_RE.test(phone)) {
    return invalidResult(phone || raw, String(item?.reason ?? 'invalid_number'), provider.name)
  }
  if (!isMtn(phone)) {
    return invalidResult(phone, 'Only MTN numbers can be verified (024, 025, 053, 054, 055)', provider.name)
  }

  if (!item || item.normalized === null) {
    return invalidResult(phone, String(item?.reason ?? 'invalid_number'), provider.name)
  }

  const accepted = Boolean(item.accepted === true)
  if (accepted) {
    return {
      phone,
      valid: true,
      verified: true,
      servable: true,
      recommendation: 'sell_any',
      status: 'verified',
      message: 'This number can be served — you may sell any bundle size.',
      provider_exists: true,
      provider_name: provider.name,
      network: 'MTN',
      cached: null,
    }
  }

  const reason = String(item.reason ?? 'Number is not allowed / needs activation')
  return {
    phone,
    valid: true,
    verified: false,
    servable: false,
    recommendation: 'activate_first',
    status: 'unverified',
    message: reason,
    provider_exists: false,
    provider_name: provider.name,
    network: 'MTN',
    cached: null,
  }
}

async function upsertCheck(
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  check: CheckResult,
) {
  if (!userId || !check.valid || check.status === 'invalid' || check.status === 'error') {
    return check
  }

  const status =
    check.status === 'submitted' || check.status === 'pending'
      ? check.status
      : check.verified
        ? 'verified'
        : 'unverified'
  const payload = {
    user_id: userId,
    phone: check.phone,
    network: 'mtn',
    status,
    provider_exists: check.provider_exists,
    provider_message: check.message,
    provider_name: check.provider_name,
    checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { data: existing } = await supabase
    .from('number_verifications')
    .select('id, status, requested_at, note')
    .eq('user_id', userId)
    .eq('phone', check.phone)
    .maybeSingle()

  if (existing && check.verified) {
    const { data } = await supabase
      .from('number_verifications')
      .update({
        ...payload,
        status: 'verified',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle()
    return { ...check, record_id: data?.id ?? existing.id }
  }

  if (existing && status === 'submitted') {
    const { data } = await supabase
      .from('number_verifications')
      .update({
        ...payload,
        status: 'submitted',
        requested_at: existing.requested_at ?? new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle()
    return { ...check, status: 'submitted', record_id: data?.id ?? existing.id }
  }

  if (existing && !check.verified && (existing.status === 'pending' || existing.status === 'submitted')) {
    const { data } = await supabase
      .from('number_verifications')
      .update({
        provider_exists: check.provider_exists,
        provider_message: check.message,
        provider_name: check.provider_name,
        checked_at: payload.checked_at,
        updated_at: payload.updated_at,
      })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle()
    return {
      ...check,
      status: existing.status as CheckResult['status'],
      record_id: data?.id ?? existing.id,
    }
  }

  const { data, error } = await supabase
    .from('number_verifications')
    .upsert(payload, { onConflict: 'user_id,phone' })
    .select('id')
    .maybeSingle()

  if (error) {
    return { ...check, message: `${check.message} (save warning: ${error.message})` }
  }

  return { ...check, record_id: data?.id }
}

async function applyVerificationWebhook(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const data = (body.data ?? body) as Record<string, unknown>
  const phone = normalizePhone(
    String(data.phone ?? data.phoneNumber ?? body.phone ?? body.phoneNumber ?? ''),
  )
  if (!phone || !PHONE_RE.test(phone)) {
    return { handled: false, reason: 'no phone' }
  }

  const exists =
    data.exists === true ||
    data.verified === true ||
    String(data.status ?? body.status ?? '').toLowerCase() === 'verified'
  const now = new Date().toISOString()
  const message = String(
    data.message ?? body.message ?? (exists ? 'Verified via Datahub webhook' : 'Updated via Datahub webhook'),
  )

  const { data: rows } = await supabase
    .from('number_verifications')
    .update({
      status: exists ? 'verified' : 'unverified',
      provider_exists: exists,
      provider_message: message,
      provider_name: 'Datahub',
      checked_at: now,
      resolved_at: exists ? now : null,
      updated_at: now,
    })
    .eq('phone', phone)
    .select('id')

  return { handled: true, phone, exists, updated: rows?.length ?? 0 }
}

/** Push a Datahub check result onto matching DB rows (by phone, optionally scoped to one user). */
async function applyCheckToPhoneRows(
  supabase: ReturnType<typeof createClient>,
  check: CheckResult,
  scopeUserId: string | null,
) {
  if (!check.valid || check.status === 'invalid' || check.status === 'error') {
    return { phone: check.phone, updated: 0 }
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    provider_exists: check.provider_exists,
    provider_message: check.message,
    provider_name: check.provider_name,
    checked_at: now,
    updated_at: now,
  }

  if (check.verified) {
    patch.status = 'verified'
    patch.resolved_at = now
  } else if (check.status === 'submitted' || check.submitted_to_provider) {
    patch.status = 'submitted'
  }

  let query = supabase.from('number_verifications').update(patch).eq('phone', check.phone)
  if (scopeUserId) query = query.eq('user_id', scopeUserId)

  const { data } = await query.select('id')
  return { phone: check.phone, updated: data?.length ?? 0, status: patch.status ?? null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabase = createClient(supabaseUrl, serviceKey)

  const url = new URL(req.url)
  let path = url.pathname
  const idx = path.indexOf('/verify-numbers')
  if (idx >= 0) path = path.slice(idx + '/verify-numbers'.length) || '/'

  try {
    let userId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      if (token !== anonKey && token !== serviceKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        })
        const { data } = await userClient.auth.getUser()
        userId = data.user?.id ?? null
      }
    }

    const { data: settings } = await supabase.from('site_settings').select('key, value')
    const settingsMap = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))
    const datahub = getDatahubProvider(settingsMap)
    const datamart = getDatamartProvider(settingsMap)

    if (req.method === 'POST' && (path === '/webhook' || path.includes('provider-webhook'))) {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      const applied = await applyVerificationWebhook(supabase, body)
      return json({ success: true, ...applied })
    }

    if (req.method === 'POST' && (path === '/check' || path === '/' || path === '/bulk')) {
      if (!datahub?.apiKey && !datamart?.apiKey) {
        return json(
          {
            success: false,
            error:
              'No number-verification provider is configured. Add a Datahub key on the tertiary slot or a DataMart API key in Admin → Site Settings.',
          },
          503,
        )
      }

      const body = await req.json().catch(() => ({}))
      const isPorted = Boolean(body.is_ported_number ?? body.isPorted)
      const rawPhones: string[] = Array.isArray(body.phones)
        ? body.phones.map(String)
        : Array.isArray(body.numbers)
          ? body.numbers.map((n: unknown) =>
              typeof n === 'string'
                ? n
                : String((n as Record<string, unknown>)?.number ?? (n as Record<string, unknown>)?._beneficiary_number ?? ''),
            )
          : body.phone
            ? [String(body.phone)]
            : body.phoneNumber
              ? [String(body.phoneNumber)]
              : []

      const phones = [...new Set(rawPhones.map(normalizePhone).filter(Boolean))]

      if (phones.length === 0) {
        return json({ success: false, error: 'phone, phones[], or numbers[] required' }, 400)
      }
      if (phones.length > 100) {
        return json({ success: false, error: 'Maximum 100 numbers per request' }, 400)
      }

      const results: CheckResult[] = []
      const toCheck: string[] = []
      const providerName = datahub?.name ?? datamart?.name ?? null
      for (const phone of phones) {
        if (!PHONE_RE.test(phone)) {
          results.push(invalidResult(phone, 'Invalid Ghana phone. Use format 0241234567', providerName))
        } else if (!isMtn(phone)) {
          results.push(
            invalidResult(phone, 'Only MTN numbers can be verified (024, 025, 053, 054, 055)', providerName),
          )
        } else {
          toCheck.push(phone)
        }
      }

      const useDatahub = Boolean(datahub?.apiKey)

      if (useDatahub && toCheck.length > 0) {
        const checked = await mapPool(toCheck, 5, async (phone) => {
          const upstream = await datahubVerifySingle(datahub!.apiKey, phone, isPorted)
          return interpretDatahub(phone, datahub!, upstream)
        })
        for (const item of checked) {
          results.push(await upsertCheck(supabase, userId, item))
        }
      } else if (datamart?.apiKey && toCheck.length === 1 && path !== '/bulk') {
        const upstream = await datamartVerifySingle(datamart.apiKey, toCheck[0])
        results.push(await upsertCheck(supabase, userId, interpretDatamartSingle(toCheck[0], datamart, upstream)))
      } else if (datamart?.apiKey && toCheck.length > 0) {
        const upstream = await datamartVerifyBulk(datamart.apiKey, toCheck)
        if (upstream.status === 429) {
          return json(
            {
              success: false,
              error: 'Too many requests — try again shortly.',
              code: 'RATE_LIMIT_EXCEEDED',
              retryAfter: (upstream.body as Record<string, unknown>).retryAfter ?? null,
            },
            429,
          )
        }
        if (!upstream.ok && upstream.body.status !== 'success') {
          for (const phone of toCheck.slice(0, 2)) {
            const one = await datamartVerifySingle(datamart.apiKey, phone)
            results.push(await upsertCheck(supabase, userId, interpretDatamartSingle(phone, datamart, one)))
          }
          for (const phone of toCheck.slice(2)) {
            results.push({
              phone,
              valid: true,
              verified: false,
              servable: null,
              recommendation: null,
              status: 'error',
              message: 'Bulk verify failed; retry these numbers separately',
              provider_exists: null,
              provider_name: datamart.name,
              network: 'MTN',
              cached: null,
            })
          }
        } else {
          const bulkResults = Array.isArray(upstream.body.results)
            ? (upstream.body.results as Record<string, unknown>[])
            : []
          const byRaw = new Map<string, Record<string, unknown>>()
          for (const item of bulkResults) {
            const key = normalizePhone(String(item.number ?? item.normalized ?? ''))
            if (key) byRaw.set(key, item)
            const orig = String(item.number ?? '')
            if (orig) byRaw.set(normalizePhone(orig), item)
          }
          for (const phone of toCheck) {
            const item =
              byRaw.get(phone) ??
              bulkResults.find(
                (r) =>
                  normalizePhone(String(r.normalized ?? '')) === phone ||
                  normalizePhone(String(r.number ?? '')) === phone,
              )
            results.push(await upsertCheck(supabase, userId, interpretDatamartBulkItem(phone, datamart, item)))
          }
        }
      }

      const verified = results.filter((r) => r.verified).length
      const unverified = results.filter((r) => r.status === 'unverified' || r.status === 'submitted').length
      const engine = useDatahub ? 'datahub' : 'datamart'
      const engineName = useDatahub ? datahub!.name : datamart!.name
      const engineSlug = useDatahub ? datahub!.slug : datamart!.slug

      return json({
        success: true,
        provider: engine,
        active_provider: engineSlug,
        provider_name: engineName,
        checked: results.length,
        verified,
        unverified,
        sell_any: results.filter((r) => r.recommendation === 'sell_any').length,
        activate_first: results.filter((r) => r.recommendation === 'activate_first').length,
        results,
        summary: path === '/bulk' || phones.length > 1
          ? {
              total: results.length,
              accepted: verified,
              rejected: unverified + results.filter((r) => r.status === 'invalid').length,
            }
          : undefined,
      })
    }

    if (req.method === 'POST' && path === '/sync') {
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
      if (!token || token === anonKey || token === serviceKey || !userId) {
        return json({ success: false, error: 'Login required' }, 401)
      }
      if (!datahub?.apiKey && !datamart?.apiKey) {
        return json({ success: false, error: 'No verification provider configured' }, 503)
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle()
      const isAdmin = Boolean(profile?.is_admin)

      const body = await req.json().catch(() => ({}))
      let phones: string[] = Array.isArray(body.phones)
        ? body.phones.map((p: unknown) => normalizePhone(String(p))).filter(Boolean)
        : []

      if (phones.length === 0) {
        let openQuery = supabase
          .from('number_verifications')
          .select('phone')
          .in('status', ['pending', 'submitted', 'unverified'])
          .order('updated_at', { ascending: false })
          .limit(100)
        if (!isAdmin) openQuery = openQuery.eq('user_id', userId)
        const { data: openRows } = await openQuery
        phones = [...new Set((openRows ?? []).map((r) => normalizePhone(String(r.phone))).filter(isMtn))]
      } else {
        phones = [...new Set(phones.filter(isMtn))].slice(0, 100)
      }

      if (phones.length === 0) {
        return json({ success: true, synced: 0, verified: 0, results: [] })
      }

      const scopeUserId = isAdmin ? null : userId
      const results: CheckResult[] = []
      const updates = []

      if (datahub?.apiKey) {
        const checked = await mapPool(phones, 5, async (phone) => {
          const upstream = await datahubVerifySingle(datahub.apiKey, phone, false)
          return interpretDatahub(phone, datahub, upstream)
        })
        for (const item of checked) {
          results.push(item)
          updates.push(await applyCheckToPhoneRows(supabase, item, scopeUserId))
          if (!isAdmin) await upsertCheck(supabase, userId, item)
        }
      } else if (datamart?.apiKey) {
        for (const phone of phones) {
          const upstream = await datamartVerifySingle(datamart.apiKey, phone)
          const item = interpretDatamartSingle(phone, datamart, upstream)
          results.push(item)
          updates.push(await applyCheckToPhoneRows(supabase, item, scopeUserId))
          if (!isAdmin) await upsertCheck(supabase, userId, item)
        }
      }

      return json({
        success: true,
        provider: datahub ? 'datahub' : 'datamart',
        synced: phones.length,
        verified: results.filter((r) => r.verified).length,
        updated_rows: updates.reduce((n, u) => n + (u.updated || 0), 0),
        results,
        updates,
      })
    }

    if (req.method === 'POST' && path === '/request') {
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
      if (!token || token === anonKey || token === serviceKey || !userId) {
        return json({ success: false, error: 'Login required to request verification' }, 401)
      }

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      })

      const body = await req.json().catch(() => ({}))
      const phones: string[] = Array.isArray(body.phones)
        ? body.phones.map(String)
        : body.phone
          ? [String(body.phone)]
          : []
      const note = body.note ? String(body.note) : null

      if (phones.length === 0) {
        return json({ success: false, error: 'phone or phones[] required' }, 400)
      }

      const results = []
      const toSubmit: string[] = []
      for (const raw of phones) {
        const phone = normalizePhone(raw)
        if (!isMtn(phone)) {
          results.push({
            phone,
            success: false,
            error: 'Only MTN numbers can be submitted (024, 025, 053, 054, 055)',
          })
          continue
        }
        const { data, error } = await userClient.rpc('request_number_verification', {
          p_user_id: userId,
          p_phone: phone,
          p_note: note,
        })
        if (!error) toSubmit.push(phone)
        results.push(error ? { phone, success: false, error: error.message } : data)
      }

      let datahubSubmit: unknown = null
      if (datahub?.apiKey && toSubmit.length > 0) {
        datahubSubmit = await datahubSubmitNumbers(datahub.apiKey, toSubmit)
        await supabase
          .from('number_verifications')
          .update({
            status: 'submitted',
            provider_name: datahub.name,
            provider_message: 'Submitted to Datahub for beneficiary approval',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .in('phone', toSubmit)
          .in('status', ['pending', 'unverified', 'submitted'])
      }

      return json({ success: true, provider: datahub ? 'datahub' : 'local', results, datahub_submit: datahubSubmit })
    }

    if (req.method === 'GET' && path === '/health') {
      if (datahub?.apiKey) {
        const upstream = await datahubVerifySingle(datahub.apiKey, '0241234567')
        return json({
          success: true,
          provider: 'datahub',
          active_provider: datahub.slug,
          provider_name: datahub.name,
          upstream_status: upstream.status,
          upstream: upstream.body,
        })
      }
      if (!datamart?.apiKey) {
        return json({ success: false, error: 'No Datahub or DataMart API key configured' }, 503)
      }
      const upstream = await datamartVerifySingle(datamart.apiKey, '0241234567')
      return json({
        success: true,
        provider: 'datamart',
        active_provider: datamart.slug,
        provider_name: datamart.name,
        upstream_status: upstream.status,
        upstream: upstream.body,
      })
    }

    return json({
      success: true,
      endpoints: {
        'POST /check': 'Verify MTN numbers via Datahub (falls back to DataMart)',
        'POST /bulk': 'Bulk verify up to 100 MTN numbers',
        'POST /sync': 'Re-check open numbers against Datahub and update live statuses',
        'POST /request': 'Submit unverified numbers to Datahub /purchases/submit-numbers (auth required)',
        'POST /webhook': 'Receive Datahub number-verification callbacks if sent',
        'GET /health': 'Check Datahub (or DataMart) verify-number connectivity',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
