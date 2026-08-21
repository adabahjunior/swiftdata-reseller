import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const API_NETWORKS = [
  { id: 'yello', label: 'Yello' },
  { id: 'at_ishare', label: 'AirtelTigo iShare' },
  { id: 'at_bigtime', label: 'AirtelTigo Bigtime' },
  { id: 'telecel', label: 'Telecel' },
]

const API_NETWORK_LABELS: Record<string, string> = Object.fromEntries(
  API_NETWORKS.map((n) => [n.id, n.label]),
)

function dbToApiNetwork(dbNetwork: string): string {
  if (dbNetwork === 'mtn') return 'yello'
  return dbNetwork
}

function apiNetworkLabel(apiNetwork: string): string {
  return API_NETWORK_LABELS[apiNetwork] ?? apiNetwork
}

function mapOrderToApi(order: Record<string, unknown>) {
  const serviceType = String(order.service_type ?? 'data')
  if (serviceType !== 'data') {
    return {
      reference: order.reference,
      service_type: serviceType,
      provider_code: order.network,
      beneficiary: order.phone,
      face_amount: order.face_amount != null ? Number(order.face_amount) : null,
      amount: Number(order.amount),
      status: order.status,
      created_at: order.created_at,
      completed_at: order.completed_at,
      utility_meta: order.utility_meta ?? {},
    }
  }
  const apiNetwork = dbToApiNetwork(String(order.network))
  return {
    reference: order.reference,
    service_type: 'data',
    phone: order.phone,
    network: apiNetwork,
    network_label: apiNetworkLabel(apiNetwork),
    size_gb: Number(order.size_gb),
    amount: Number(order.amount),
    status: order.status,
    created_at: order.created_at,
    completed_at: order.completed_at,
  }
}

function mapPackageToApi(pkg: Record<string, unknown>) {
  const apiNetwork = dbToApiNetwork(String(pkg.network))
  return {
    network: apiNetwork,
    network_label: apiNetworkLabel(apiNetwork),
    size_gb: Number(pkg.size_gb),
    price: Number(pkg.price),
    validity: pkg.validity,
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function triggerProviderFulfillment(orderId?: string) {
  const base = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!base || !key) return

  const path = orderId ? `/order/${orderId}` : '/process'
  void fetch(`${base}/functions/v1/fulfill-orders${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => {
    /* background */
  })
}

function triggerXcelFulfillment(orderId?: string) {
  const base = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!base || !key) return

  const path = orderId ? `/order/${orderId}` : '/process'
  void fetch(`${base}/functions/v1/fulfill-xcel-orders${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => {
    /* background */
  })
}

function triggerSmsDispatch() {
  const base = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!base || !key) return

  void fetch(`${base}/functions/v1/send-sms/process`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => {
    /* background */
  })
}

function error(message: string, status = 400) {
  return json({ success: false, error: message }, status)
}

function parseApiPhones(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.phones)) return body.phones.map(String)
  if (Array.isArray(body.numbers)) {
    return body.numbers.map((n: unknown) =>
      typeof n === 'string'
        ? n
        : String(
            (n as Record<string, unknown>)?.number ??
              (n as Record<string, unknown>)?._beneficiary_number ??
              '',
          ),
    )
  }
  if (body.phone) return [String(body.phone)]
  if (body.phoneNumber) return [String(body.phoneNumber)]
  return []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const start = Date.now()
  const url = new URL(req.url)
  let path = url.pathname
  const apiIdx = path.indexOf('/v1/')
  path = apiIdx >= 0 ? path.slice(apiIdx) : path.replace(/\/+$/, '') || '/'

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  let userId: string | null = null
  let keyId: string | null = null
  let statusCode = 200
  let responseBody: unknown = null

  const authHeader = req.headers.get('Authorization')
  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null

  if (!apiKey) {
    return error('Missing Authorization header. Use: Bearer sk_live_...', 401)
  }

  const { data: keyData, error: keyError } = await supabase.rpc('api_validate_key', {
    p_key: apiKey,
  })

  if (keyError || !keyData?.valid) {
    return error(keyData?.error ?? 'Invalid or inactive API key', 401)
  }

  userId = keyData.user_id
  keyId = keyData.key_id

  try {
    if (path === '/v1/balance' && req.method === 'GET') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', userId)
        .single()

      responseBody = {
        success: true,
        balance: Number(profile?.wallet_balance ?? 0),
        currency: 'GHS',
      }
    } else if (path === '/v1/packages' && req.method === 'GET') {
      const [{ data: packages }, { data: overrides }] = await Promise.all([
        supabase
          .from('data_packages')
          .select('id, network, size_gb, price, validity')
          .eq('active', true)
          .order('network')
          .order('size_gb'),
        supabase
          .from('user_package_prices')
          .select('package_id, price')
          .eq('user_id', userId),
      ])

      const overrideMap = new Map(
        (overrides ?? []).map((row) => [String(row.package_id), Number(row.price)]),
      )

      responseBody = {
        success: true,
        networks: API_NETWORKS,
        packages: (packages ?? []).map((p) => {
          const base = p as Record<string, unknown>
          const custom = overrideMap.get(String(base.id))
          return mapPackageToApi({
            ...base,
            price: custom ?? Number(base.price),
          })
        }),
      }
    } else if (path === '/v1/buy-data' && req.method === 'POST') {
      const body = await req.json()
      const phone = String(body.phone ?? '').trim()
      const network = String(body.network ?? '').trim()
      const sizeGb = Number(body.size_gb)
      const reference = body.reference ? String(body.reference).trim() : null

      if (!phone || !/^0[2-5]\d{8}$/.test(phone)) {
        statusCode = 400
        responseBody = { success: false, error: 'Invalid phone. Use Ghana format e.g. 0241234567' }
      } else if (!network) {
        statusCode = 400
        responseBody = { success: false, error: 'network is required (yello, at_ishare, at_bigtime, telecel)' }
      } else if (!sizeGb || sizeGb <= 0) {
        statusCode = 400
        responseBody = { success: false, error: 'size_gb is required and must be greater than 0' }
      } else {
        const { data: result, error: buyError } = await supabase.rpc('api_buy_data', {
          p_user_id: userId,
          p_api_key_id: keyId,
          p_network: network,
          p_size_gb: sizeGb,
          p_phone: phone,
          p_reference: reference,
        })

        if (buyError) {
          statusCode = 500
          responseBody = { success: false, error: buyError.message }
          triggerSmsDispatch()
        } else if (!result?.success) {
          statusCode = 400
          responseBody = result
          triggerSmsDispatch()
        } else {
          responseBody = {
            success: true,
            order: mapOrderToApi(result.order as Record<string, unknown>),
          }
          const orderId = (result.order as Record<string, unknown>)?.id
          if (orderId) triggerProviderFulfillment(String(orderId))
          else triggerProviderFulfillment()
          triggerSmsDispatch()
        }
      }
    } else if (path === '/v1/utility-products' && req.method === 'GET') {
      const serviceType = (url.searchParams.get('type') || '').trim().toLowerCase()
      let query = supabase
        .from('utility_products')
        .select(
          'service_type, provider_code, label, min_amount, max_amount, markup_percent, flat_fee',
        )
        .eq('active', true)
        .order('service_type')
        .order('display_order')
      if (['airtime', 'ecg', 'tv'].includes(serviceType)) {
        query = query.eq('service_type', serviceType)
      }
      const { data: products } = await query
      responseBody = {
        success: true,
        products: (products ?? []).map((p) => ({
          service_type: p.service_type,
          provider_code: p.provider_code,
          label: p.label,
          min_amount: Number(p.min_amount),
          max_amount: Number(p.max_amount),
          markup_percent: Number(p.markup_percent),
          flat_fee: Number(p.flat_fee),
        })),
      }
    } else if (
      (path === '/v1/buy-airtime' || path === '/v1/buy-ecg' || path === '/v1/buy-tv' || path === '/v1/buy-utility') &&
      req.method === 'POST'
    ) {
      const body = await req.json().catch(() => ({}))
      const serviceType =
        path === '/v1/buy-airtime'
          ? 'airtime'
          : path === '/v1/buy-ecg'
            ? 'ecg'
            : path === '/v1/buy-tv'
              ? 'tv'
              : String(body.service_type ?? '').trim().toLowerCase()
      const providerCode = String(body.provider_code ?? body.network ?? '').trim()
      const beneficiary = String(body.beneficiary ?? body.phone ?? body.meter ?? body.smartcard ?? '').trim()
      const faceAmount = Number(body.amount ?? body.face_amount)
      const reference = body.reference ? String(body.reference).trim() : null
      const accountName = body.account_name ? String(body.account_name).trim() : null

      if (!['airtime', 'ecg', 'tv'].includes(serviceType)) {
        statusCode = 400
        responseBody = { success: false, error: 'service_type must be airtime, ecg, or tv' }
      } else if (!providerCode) {
        statusCode = 400
        responseBody = { success: false, error: 'provider_code is required' }
      } else if (!beneficiary) {
        statusCode = 400
        responseBody = { success: false, error: 'beneficiary is required (phone / meter / smartcard)' }
      } else if (!faceAmount || faceAmount <= 0) {
        statusCode = 400
        responseBody = { success: false, error: 'amount must be greater than 0' }
      } else if (serviceType === 'airtime' && !/^0[2-5]\d{8}$/.test(beneficiary)) {
        statusCode = 400
        responseBody = { success: false, error: 'Invalid phone. Use Ghana format e.g. 0241234567' }
      } else {
        const { data: result, error: buyError } = await supabase.rpc('api_buy_utility', {
          p_user_id: userId,
          p_api_key_id: keyId,
          p_service_type: serviceType,
          p_provider_code: providerCode,
          p_beneficiary: beneficiary,
          p_face_amount: faceAmount,
          p_reference: reference,
          p_account_name: accountName,
          p_extra: {},
        })

        if (buyError) {
          statusCode = 500
          responseBody = { success: false, error: buyError.message }
          triggerSmsDispatch()
        } else if (!result?.success) {
          statusCode = 400
          responseBody = result
          triggerSmsDispatch()
        } else {
          responseBody = {
            success: true,
            order: mapOrderToApi({
              ...(result.order as Record<string, unknown>),
              phone: (result.order as Record<string, unknown>).beneficiary,
              network: (result.order as Record<string, unknown>).provider_code,
            }),
          }
          const orderId = (result.order as Record<string, unknown>)?.id
          if (orderId) triggerXcelFulfillment(String(orderId))
          else triggerXcelFulfillment()
          triggerSmsDispatch()
        }
      }
    } else if (
      (path === '/v1/verify-number' || path === '/v1/verify-number/bulk') &&
      req.method === 'POST'
    ) {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      const phones = parseApiPhones(body)

      const max = 100
      if (phones.length === 0) {
        statusCode = 400
        responseBody = { success: false, error: 'phone, phones[], or numbers[] is required' }
      } else if (phones.length > max) {
        statusCode = 400
        responseBody = { success: false, error: 'Maximum 100 numbers per request' }
      } else {
        const base = Deno.env.get('SUPABASE_URL')
        const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        if (!base || !key) {
          statusCode = 500
          responseBody = { success: false, error: 'Server misconfigured' }
        } else {
          const useBulk = path.endsWith('/bulk') || phones.length > 1
          const verifyRes = await fetch(
            `${base}/functions/v1/verify-numbers/${useBulk ? 'bulk' : 'check'}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ phones, user_id: userId }),
            },
          )
          const verifyBody = await verifyRes.json().catch(() => ({}))
          if (!verifyRes.ok || !verifyBody?.success) {
            statusCode = verifyRes.status >= 400 ? verifyRes.status : 502
            responseBody = verifyBody?.error
              ? verifyBody
              : { success: false, error: 'Provider verification failed' }
          } else {
            responseBody = {
              success: true,
              checked: verifyBody.checked,
              verified: verifyBody.verified,
              unverified: verifyBody.unverified,
              sell_any: verifyBody.sell_any,
              activate_first: verifyBody.activate_first,
              summary: verifyBody.summary,
              results: verifyBody.results,
            }
          }
        }
      }
    } else if (
      (path === '/v1/submit-numbers' || path === '/v1/verify-number/submit') &&
      req.method === 'POST'
    ) {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      const phones = parseApiPhones(body)
      const note = body.note != null ? String(body.note) : undefined
      const skipCheck = body.skip_check === true || body.skipCheck === true

      const max = 100
      if (phones.length === 0) {
        statusCode = 400
        responseBody = { success: false, error: 'phone, phones[], or numbers[] is required' }
      } else if (phones.length > max) {
        statusCode = 400
        responseBody = { success: false, error: 'Maximum 100 numbers per request' }
      } else {
        const base = Deno.env.get('SUPABASE_URL')
        const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        if (!base || !key) {
          statusCode = 500
          responseBody = { success: false, error: 'Server misconfigured' }
        } else {
          let checkBody: Record<string, unknown> | null = null
          let toSubmit = phones
          let failed = false

          if (!skipCheck) {
            const useBulk = phones.length > 1
            const verifyRes = await fetch(
              `${base}/functions/v1/verify-numbers/${useBulk ? 'bulk' : 'check'}`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${key}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ phones, user_id: userId }),
              },
            )
            checkBody = (await verifyRes.json().catch(() => ({}))) as Record<string, unknown>
            if (!verifyRes.ok || !checkBody?.success) {
              statusCode = verifyRes.status >= 400 ? verifyRes.status : 502
              responseBody = checkBody?.error
                ? checkBody
                : { success: false, error: 'Provider verification failed' }
              failed = true
            } else {
              const results = Array.isArray(checkBody.results)
                ? (checkBody.results as Record<string, unknown>[])
                : []
              toSubmit = results
                .filter((r) => {
                  const status = String(r.status ?? '')
                  return (
                    r.valid !== false &&
                    !r.verified &&
                    status !== 'invalid' &&
                    status !== 'error' &&
                    (r.recommendation === 'activate_first' ||
                      status === 'unverified' ||
                      status === 'submitted' ||
                      status === 'pending')
                  )
                })
                .map((r) => String(r.phone))
            }
          }

          if (!failed) {
            let submitBody: Record<string, unknown> = {
              success: true,
              submitted: 0,
              results: [],
              datahub_submit: null,
            }

            if (toSubmit.length > 0) {
              const submitRes = await fetch(`${base}/functions/v1/verify-numbers/request`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${key}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ phones: toSubmit, user_id: userId, note }),
              })
              submitBody = (await submitRes.json().catch(() => ({}))) as Record<string, unknown>
              if (!submitRes.ok || submitBody?.success === false) {
                statusCode = submitRes.status >= 400 ? submitRes.status : 502
                responseBody = submitBody?.error
                  ? submitBody
                  : { success: false, error: 'Number submit failed' }
                failed = true
              }
            }

            if (!failed) {
              const alreadyVerified = Array.isArray(checkBody?.results)
                ? (checkBody!.results as Record<string, unknown>[]).filter((r) => r.verified)
                    .length
                : 0
              responseBody = {
                success: true,
                checked: checkBody?.checked ?? phones.length,
                verified: checkBody?.verified ?? alreadyVerified,
                unverified: checkBody?.unverified ?? null,
                submitted: submitBody.submitted ?? toSubmit.length,
                skipped_already_verified: alreadyVerified,
                note: note ?? null,
                check: checkBody
                  ? {
                      sell_any: checkBody.sell_any,
                      activate_first: checkBody.activate_first,
                      results: checkBody.results,
                      summary: checkBody.summary,
                    }
                  : null,
                results: submitBody.results ?? [],
                datahub_submit: submitBody.datahub_submit ?? null,
              }
            }
          }
        }
      }
    } else if (path === '/v1/orders' && req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100)
      const offset = Number(url.searchParams.get('offset') ?? 0)

      const { data: orders } = await supabase
        .from('orders')
        .select(
          'reference, phone, network, size_gb, amount, status, created_at, completed_at, service_type, face_amount, utility_meta',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      responseBody = {
        success: true,
        orders: (orders ?? []).map((o) => mapOrderToApi(o as Record<string, unknown>)),
      }
    } else if (path.startsWith('/v1/orders/') && req.method === 'GET') {
      const reference = decodeURIComponent(path.replace('/v1/orders/', ''))

      const { data: order } = await supabase
        .from('orders')
        .select(
          'reference, phone, network, size_gb, amount, status, created_at, completed_at, service_type, face_amount, utility_meta',
        )
        .eq('user_id', userId)
        .eq('reference', reference)
        .maybeSingle()

      if (!order) {
        statusCode = 404
        responseBody = { success: false, error: 'Order not found' }
      } else {
        responseBody = {
          success: true,
          order: mapOrderToApi(order as Record<string, unknown>),
        }
      }
    } else if (path === '/v1/health' && req.method === 'GET') {
      responseBody = {
        success: true,
        status: 'operational',
        timestamp: new Date().toISOString(),
        networks: API_NETWORKS.map((n) => n.id),
      }
    } else {
      statusCode = 404
      responseBody = { success: false, error: 'Endpoint not found' }
    }
  } catch (e) {
    statusCode = 500
    responseBody = { success: false, error: (e as Error).message }
  }

  if (userId) {
    await supabase.from('api_logs').insert({
      user_id: userId,
      api_key_id: keyId,
      endpoint: path,
      method: req.method,
      status_code: statusCode,
      response_time_ms: Date.now() - start,
    })
  }

  return json(responseBody, statusCode)
})
