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
  status: 'verified' | 'unverified' | 'invalid' | 'error' | 'pending' | 'submitted' | 'failed'
  message: string
  provider_exists: boolean | null
  provider_name: string | null
  record_id?: string
}

export type NumberCheckResponse = {
  success: boolean
  error?: string
  provider_name?: string
  checked?: number
  verified?: number
  unverified?: number
  results?: NumberCheckResult[]
}

/** Check one or more phones against Datahub beneficiary list. */
export async function checkNumbers(phones: string[], userJwt?: string | null): Promise<NumberCheckResponse> {
  const headers = authHeaders()
  if (userJwt) headers.Authorization = `Bearer ${userJwt}`

  const res = await fetch(`${VERIFY_URL}/check`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phones }),
  })
  return (await res.json()) as NumberCheckResponse
}

/** Request verification for unverified numbers. */
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
