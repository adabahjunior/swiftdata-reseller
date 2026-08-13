const VERIFY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-numbers`

function authHeaders() {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  return {
    Authorization: `Bearer ${anon}`,
    apikey: anon,
    'Content-Type': 'application/json',
  }
}

export type NumberCheckResult = {
  phone: string
  valid: boolean
  verified: boolean
  servable: boolean | null
  recommendation: 'sell_any' | 'activate_first' | null
  status: 'verified' | 'unverified' | 'invalid' | 'error' | 'pending' | 'submitted' | 'failed'
  message: string
  provider_exists: boolean | null
  provider_name: string | null
  network?: string | null
  cached?: boolean | null
  record_id?: string
}

export type NumberCheckResponse = {
  success: boolean
  error?: string
  provider_name?: string
  checked?: number
  verified?: number
  unverified?: number
  sell_any?: number
  activate_first?: number
  results?: NumberCheckResult[]
  summary?: { total: number; accepted: number; rejected: number }
}

/** Check one or more MTN phones via DataMart (auto uses bulk for 2+). */
export async function checkNumbers(phones: string[], userJwt?: string | null): Promise<NumberCheckResponse> {
  const headers = authHeaders()
  if (userJwt) headers.Authorization = `Bearer ${userJwt}`

  const path = phones.length > 1 ? '/bulk' : '/check'
  const res = await fetch(`${VERIFY_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phones }),
  })
  return (await res.json()) as NumberCheckResponse
}

/** Queue activate_first / unverified numbers for admin follow-up. */
export async function requestNumberVerification(
  phones: string[],
  userJwt: string,
  note?: string,
) {
  const res = await fetch(`${VERIFY_URL}/request`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      Authorization: `Bearer ${userJwt}`,
    },
    body: JSON.stringify({ phones, note }),
  })
  return res.json()
}

export function isMtnPhone(phone: string) {
  return /^0(24|54|55|59)\d{7}$/.test(phone)
}
