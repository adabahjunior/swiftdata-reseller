import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DATAMART_BASE = 'https://api.datamartgh.shop/api/developer'
/** MTN Ghana prefixes (Datamart verify-number is MTN-only). */
const MTN_PREFIX_RE = /^0(24|54|55|59)\d{7}$/
const PHONE_RE = /^0[2-5]\d{8}$/

type ProviderCred = {
  slug: 'primary' | 'secondary'
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

/** Prefer DataMart credentials from provider slots, then dedicated datamart_api_key. */
function getDatamartProvider(settingsMap: Record<string, string>): ProviderCred | null {
  const primaryType = (settingsMap.data_provider_primary_type || '').trim().toLowerCase()
  const secondaryType = (settingsMap.data_provider_secondary_type || '').trim().toLowerCase()

  if (primaryType === 'datamart' && settingsMap.data_provider_primary_api_key?.trim()) {
    return {
      slug: 'primary',
      name: settingsMap.data_provider_primary_name?.trim() || 'DataMart GH',
      apiKey: settingsMap.data_provider_primary_api_key.trim(),
    }
  }
  if (secondaryType === 'datamart' && settingsMap.data_provider_secondary_api_key?.trim()) {
    return {
      slug: 'secondary',
      name: settingsMap.data_provider_secondary_name?.trim() || 'DataMart GH',
      apiKey: settingsMap.data_provider_secondary_api_key.trim(),
    }
  }

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

function interpretSingle(
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
      'Only MTN numbers can be verified (024, 054, 055, 059)',
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
      message: `Rate limited${retry ? ` — retry after ${retry}s` : ''}. DataMart allows 2 single checks/min.`,
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

function interpretBulkItem(
  raw: string,
  provider: ProviderCred,
  item: Record<string, unknown> | undefined,
): CheckResult {
  const phone = normalizePhone(String(item?.normalized ?? item?.number ?? raw))
  if (!PHONE_RE.test(phone)) {
    return invalidResult(
      phone || raw,
      String(item?.reason ?? 'invalid_number'),
      provider.name,
    )
  }
  if (!isMtn(phone)) {
    return invalidResult(phone, 'Only MTN numbers can be verified (024, 054, 055, 059)', provider.name)
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

  const status = check.verified ? 'verified' : 'unverified'
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
    const provider = getDatamartProvider(settingsMap)

    if (req.method === 'POST' && (path === '/check' || path === '/' || path === '/bulk')) {
      if (!provider?.apiKey) {
        return json(
          {
            success: false,
            error:
              'DataMart API key is not configured. Set primary or secondary provider type to DataMart GH in Admin → Site Settings.',
          },
          503,
        )
      }

      const body = await req.json().catch(() => ({}))
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

      // Local MTN filter first
      const toCheck: string[] = []
      for (const phone of phones) {
        if (!PHONE_RE.test(phone)) {
          results.push(invalidResult(phone, 'Invalid Ghana phone. Use format 0241234567', provider.name))
        } else if (!isMtn(phone)) {
          results.push(
            invalidResult(phone, 'Only MTN numbers can be verified (024, 054, 055, 059)', provider.name),
          )
        } else {
          toCheck.push(phone)
        }
      }

      if (toCheck.length === 1 && path !== '/bulk') {
        const upstream = await datamartVerifySingle(provider.apiKey, toCheck[0])
        const interpreted = interpretSingle(toCheck[0], provider, upstream)
        results.push(await upsertCheck(supabase, userId, interpreted))
      } else if (toCheck.length > 0) {
        // Prefer bulk endpoint (higher rate limit) for 2+ numbers or explicit /bulk
        const upstream = await datamartVerifyBulk(provider.apiKey, toCheck)
        if (upstream.status === 429) {
          return json(
            {
              success: false,
              error: 'DataMart bulk rate limit exceeded (10 requests/min). Retry shortly.',
              code: 'RATE_LIMIT_EXCEEDED',
              retryAfter: (upstream.body as Record<string, unknown>).retryAfter ?? null,
            },
            429,
          )
        }
        if (!upstream.ok && upstream.body.status !== 'success') {
          // Fall back to sequential single checks if bulk fails (capped)
          for (const phone of toCheck.slice(0, 2)) {
            const one = await datamartVerifySingle(provider.apiKey, phone)
            results.push(await upsertCheck(supabase, userId, interpretSingle(phone, provider, one)))
          }
          for (const phone of toCheck.slice(2)) {
            results.push({
              phone,
              valid: true,
              verified: false,
              servable: null,
              recommendation: null,
              status: 'error',
              message: 'Bulk verify failed; retry these numbers separately (rate limits apply)',
              provider_exists: null,
              provider_name: provider.name,
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
            results.push(await upsertCheck(supabase, userId, interpretBulkItem(phone, provider, item)))
          }
        }
      }

      const verified = results.filter((r) => r.verified).length
      const unverified = results.filter((r) => r.status === 'unverified').length

      return json({
        success: true,
        provider: 'datamart',
        active_provider: provider.slug,
        provider_name: provider.name,
        checked: results.length,
        verified,
        unverified,
        sell_any: results.filter((r) => r.recommendation === 'sell_any').length,
        activate_first: results.filter((r) => r.recommendation === 'activate_first').length,
        results,
        summary: (path === '/bulk' || phones.length > 1)
          ? {
              total: results.length,
              accepted: verified,
              rejected: unverified + results.filter((r) => r.status === 'invalid').length,
            }
          : undefined,
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
      for (const raw of phones) {
        const phone = normalizePhone(raw)
        if (!isMtn(phone)) {
          results.push({
            phone,
            success: false,
            error: 'Only MTN numbers can be submitted (024, 054, 055, 059)',
          })
          continue
        }
        const { data, error } = await userClient.rpc('request_number_verification', {
          p_user_id: userId,
          p_phone: phone,
          p_note: note,
        })
        results.push(error ? { phone, success: false, error: error.message } : data)
      }

      return json({ success: true, results })
    }

    if (req.method === 'GET' && path === '/health') {
      if (!provider?.apiKey) {
        return json({ success: false, error: 'DataMart API key not configured' }, 503)
      }
      const upstream = await datamartVerifySingle(provider.apiKey, '0241234567')
      return json({
        success: true,
        provider: 'datamart',
        active_provider: provider.slug,
        provider_name: provider.name,
        upstream_status: upstream.status,
        upstream: upstream.body,
      })
    }

    return json({
      success: true,
      endpoints: {
        'POST /check': 'Verify one or more MTN numbers via DataMart (uses bulk when 2+)',
        'POST /bulk': 'Bulk verify up to 100 MTN numbers via DataMart',
        'POST /request': 'Queue activate_first numbers for admin follow-up (auth required)',
        'GET /health': 'Check DataMart verify-number connectivity',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
