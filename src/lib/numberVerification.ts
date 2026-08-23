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
  submitted_to_provider?: boolean
}

export type NumberCheckResponse = {
  success: boolean
  error?: string
  provider?: string
  provider_name?: string
  checked?: number
  verified?: number
  unverified?: number
  sell_any?: number
  activate_first?: number
  results?: NumberCheckResult[]
  summary?: { total: number; accepted: number; rejected: number }
}

/** Check one or more MTN phones via Datahub (auto uses bulk for 2+). */
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

/** Re-check open numbers against Datahub and update DB statuses. */
export async function syncVerificationStatuses(userJwt: string, phones?: string[]) {
  const res = await fetch(`${VERIFY_URL}/sync`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      Authorization: `Bearer ${userJwt}`,
    },
    body: JSON.stringify(phones?.length ? { phones } : {}),
  })
  return (await res.json()) as {
    success: boolean
    error?: string
    synced?: number
    verified?: number
    updated_rows?: number
    results?: NumberCheckResult[]
  }
}

/** Submit numbers to Datahub beneficiary approval + local queue. */
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
  return res.json() as Promise<{
    success: boolean
    error?: string
    provider?: string
    results?: unknown[]
    datahub_submit?: unknown
  }>
}

/**
 * Check via provider, then submit any unverified numbers for approval.
 */
export async function submitNumbersForVerification(phones: string[], userJwt: string) {
  const check = await checkNumbers(phones, userJwt)
  if (!check.success) {
    return { success: false as const, error: check.error ?? 'Verification check failed', check }
  }

  const toSubmit = (check.results ?? [])
    .filter(
      (r) =>
        r.valid &&
        !r.verified &&
        r.status !== 'invalid' &&
        r.status !== 'error' &&
        (r.recommendation === 'activate_first' ||
          r.status === 'unverified' ||
          r.status === 'submitted'),
    )
    .map((r) => r.phone)

  let submit: Awaited<ReturnType<typeof requestNumberVerification>> | null = null
  if (toSubmit.length > 0) {
    submit = await requestNumberVerification(toSubmit, userJwt)
  }

  return {
    success: true as const,
    check,
    submit,
    submitted: toSubmit.length,
    verified: check.verified ?? 0,
  }
}

export function isMtnPhone(phone: string) {
  return /^0(24|25|53|54|55|59)\d{7}$/.test(phone)
}
