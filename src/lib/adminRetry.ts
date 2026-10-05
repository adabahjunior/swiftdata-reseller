import { supabase } from './supabase'

export type AdminRetryResult = {
  success: boolean
  error?: string
  /** The order may still be live at a provider; re-sending can deliver it twice. */
  needs_confirmation?: boolean
  cancelled?: boolean
  reference?: string
  provider_error?: string | null
  order?: { id: string; reference: string; status: string; user_id?: string }
}

export async function callAdminRetry(adminId: string, orderId: string, force = false): Promise<AdminRetryResult> {
  const { data, error } = await supabase.rpc('admin_retry_failed_order', {
    p_admin_id: adminId,
    p_order_id: orderId,
    p_force: force,
  })
  if (error) return { success: false, error: error.message }
  return (data as AdminRetryResult | null) ?? { success: false, error: 'Retry failed' }
}

export function duplicateRiskPrompt(result: AdminRetryResult) {
  return [
    result.reference ? `Order ${result.reference}` : '',
    result.error,
    result.provider_error ? `Last provider note: ${result.provider_error}` : '',
    'Check the provider dashboard first. Send it again anyway?',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Retry one order, asking the admin before re-sending an order that may already be live. */
export async function adminRetryWithConfirm(adminId: string, orderId: string): Promise<AdminRetryResult> {
  const result = await callAdminRetry(adminId, orderId)
  if (!result.needs_confirmation) return result
  if (!window.confirm(duplicateRiskPrompt(result))) {
    return { ...result, cancelled: true }
  }
  return callAdminRetry(adminId, orderId, true)
}
