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
  const apiNetwork = dbToApiNetwork(String(order.network))
  return {
    reference: order.reference,
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

function error(message: string, status = 400) {
  return json({ success: false, error: message }, status)
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
      const { data: packages } = await supabase
        .from('data_packages')
        .select('network, size_gb, price, validity')
        .eq('active', true)
        .order('network')
        .order('size_gb')

      responseBody = {
        success: true,
        networks: API_NETWORKS,
        packages: (packages ?? []).map((p) => mapPackageToApi(p as Record<string, unknown>)),
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
        } else if (!result?.success) {
          statusCode = 400
          responseBody = result
        } else {
          responseBody = {
            success: true,
            order: mapOrderToApi(result.order as Record<string, unknown>),
          }
        }
      }
    } else if (path === '/v1/orders' && req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100)
      const offset = Number(url.searchParams.get('offset') ?? 0)

      const { data: orders } = await supabase
        .from('orders')
        .select('reference, phone, network, size_gb, amount, status, created_at, completed_at')
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
        .select('reference, phone, network, size_gb, amount, status, created_at, completed_at')
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
