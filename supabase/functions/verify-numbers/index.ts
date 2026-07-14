import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const DATAHUB_BASE = 'https://user.datahubgh.com/api/external'
const PHONE_RE = /^0[2-5]\d{8}$/

type ProviderSlug = 'primary' | 'secondary'

type ActiveProvider = {
  slug: ProviderSlug
  name: string
  apiKey: string
}

type CheckResult = {
  phone: string
  valid: boolean
  verified: boolean
  status: 'verified' | 'unverified' | 'invalid' | 'error'
  message: string
  provider_exists: boolean | null
  provider_name: string | null
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
  else if (phone.startsWith('233') && phone.length === 12) phone = `0${phone.slice(3)}`
  return phone
}

/** Number verification always uses Datahub (primary). SK Plug has no beneficiary check API. */
function getDatahubProvider(
  settingsMap: Record<string, string>,
  envFallback?: string | null,
): ActiveProvider {
  const primaryType = settingsMap.data_provider_primary_type?.trim() || 'datahub'
  const secondaryType = settingsMap.data_provider_secondary_type?.trim() || 'skplug'

  if (primaryType !== 'skplug') {
    return {
      slug: 'primary',
      name: settingsMap.data_provider_primary_name?.trim() || 'Primary Datahub',
      apiKey:
        settingsMap.data_provider_primary_api_key?.trim() || envFallback?.trim() || '',
    }
  }

  if (secondaryType === 'datahub') {
    return {
      slug: 'secondary',
      name: settingsMap.data_provider_secondary_name?.trim() || 'Datahub',
      apiKey: settingsMap.data_provider_secondary_api_key?.trim() || envFallback?.trim() || '',
    }
  }

  return {
    slug: 'primary',
    name: settingsMap.data_provider_primary_name?.trim() || 'Primary Datahub',
    apiKey: settingsMap.data_provider_primary_api_key?.trim() || envFallback?.trim() || '',
  }
}

async function datahubVerifyNumber(apiKey: string, phone: string) {
  const res = await fetch(`${DATAHUB_BASE}/purchases/verify-number`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phone }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

function interpretVerify(phone: string, provider: ActiveProvider, result: { ok: boolean; status: number; body: Record<string, unknown> }): Omit<CheckResult, 'record_id'> {
  const data = (result.body?.data ?? {}) as Record<string, unknown>
  const exists = Boolean(data.exists === true || result.body?.exists === true)
  const success = Boolean(result.body?.success) && exists

  if (!PHONE_RE.test(phone)) {
    return {
      phone,
      valid: false,
      verified: false,
      status: 'invalid',
      message: 'Invalid Ghana phone. Use format 0241234567',
      provider_exists: null,
      provider_name: provider.name,
    }
  }

  if (success) {
    return {
      phone,
      valid: true,
      verified: true,
      status: 'verified',
      message: String(data.message ?? result.body?.message ?? 'Number is verified'),
      provider_exists: true,
      provider_name: provider.name,
    }
  }

  // Datahub returns success:false + "Failed to verify phone number" for unverified numbers
  const errMsg = String(result.body?.error ?? result.body?.message ?? 'Number is not verified')
  if (result.status === 400 && /invalid|format|phone/i.test(errMsg)) {
    return {
      phone,
      valid: false,
      verified: false,
      status: 'invalid',
      message: errMsg,
      provider_exists: false,
      provider_name: provider.name,
    }
  }

  return {
    phone,
    valid: true,
    verified: false,
    status: 'unverified',
    message: errMsg.includes('Failed to verify') ? 'Number is not on the verified beneficiary list' : errMsg,
    provider_exists: false,
    provider_name: provider.name,
  }
}

async function upsertCheck(
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  check: Omit<CheckResult, 'record_id'>,
) {
  if (!userId || !check.valid || check.status === 'invalid') return check

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

  // Preserve pending/submitted if still awaiting admin and still unverified at provider
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
    return { ...check, status: existing.status as CheckResult['status'], record_id: data?.id ?? existing.id }
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

  const envFallback = Deno.env.get('DATAHUB_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  const supabase = createClient(supabaseUrl, serviceKey)

  const url = new URL(req.url)
  let path = url.pathname
  const idx = path.indexOf('/verify-numbers')
  if (idx >= 0) path = path.slice(idx + '/verify-numbers'.length) || '/'

  try {
    // Resolve optional user from JWT (dashboard) — optional for internal API key flows
    let userId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      // Ignore if it's the anon/service key alone without a user JWT
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
    const provider = getDatahubProvider(settingsMap, envFallback)

    if (req.method === 'POST' && (path === '/check' || path === '/')) {
      if (!provider.apiKey) {
        return json({ success: false, error: `No API key for active ${provider.slug} provider` }, 500)
      }

      const body = await req.json().catch(() => ({}))
      const rawPhones: string[] = Array.isArray(body.phones)
        ? body.phones.map(String)
        : body.phone
          ? [String(body.phone)]
          : []

      if (rawPhones.length === 0) {
        return json({ success: false, error: 'phone or phones[] required' }, 400)
      }

      if (rawPhones.length > 50) {
        return json({ success: false, error: 'Maximum 50 numbers per request' }, 400)
      }

      const results: CheckResult[] = []
      for (const raw of rawPhones) {
        const phone = normalizePhone(raw)
        if (!PHONE_RE.test(phone)) {
          results.push({
            phone,
            valid: false,
            verified: false,
            status: 'invalid',
            message: 'Invalid Ghana phone. Use format 0241234567',
            provider_exists: null,
            provider_name: provider.name,
          })
          continue
        }

        const upstream = await datahubVerifyNumber(provider.apiKey, phone)
        const interpreted = interpretVerify(phone, provider, upstream)
        results.push(await upsertCheck(supabase, userId, interpreted))
      }

      return json({
        success: true,
        active_provider: provider.slug,
        provider_name: provider.name,
        checked: results.length,
        verified: results.filter((r) => r.verified).length,
        unverified: results.filter((r) => r.status === 'unverified' || r.status === 'pending' || r.status === 'submitted').length,
        results,
      })
    }

    if (req.method === 'POST' && path === '/request') {
      const authHeader = req.headers.get('Authorization')
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
      if (!provider.apiKey) {
        return json({ success: false, error: 'No provider API key' }, 500)
      }
      // Probe with a known format number — health only cares that endpoint responds
      const upstream = await datahubVerifyNumber(provider.apiKey, '0241234567')
      return json({
        success: true,
        active_provider: provider.slug,
        provider_name: provider.name,
        datahub_status: upstream.status,
        datahub: upstream.body,
      })
    }

    return json({
      success: true,
      endpoints: {
        'POST /check': 'Check one or more MTN numbers against Datahub beneficiary list',
        'POST /request': 'Request verification for unverified numbers (auth required)',
        'GET /health': 'Check provider verify-number connectivity',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
