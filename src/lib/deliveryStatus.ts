type DeliveryOrder = {
  status: string
  provider_status?: string | null
  provider_error?: string | null
  failure_reason?: string | null
}

const STATUS_HINT: Record<string, string> = {
  pending: 'Waiting to be sent to provider',
  processing: 'Being delivered',
  completed: 'Delivered successfully',
  failed: 'Order failed',
}

const PROVIDER_FAILED = new Set([
  'failed',
  'failure',
  'error',
  'cancelled',
  'canceled',
  'rejected',
])

/** Provider rejected the purchase (even if local status is still Delivered). */
export function isProviderRejected(order: DeliveryOrder): boolean {
  const provider = order.provider_status?.toLowerCase().trim() ?? ''
  if (PROVIDER_FAILED.has(provider)) return true
  return Boolean(order.provider_error?.trim())
}

/** Admin can retry failed orders and delivered/pending orders rejected by the provider. */
export function canAdminRetryOrder(order: DeliveryOrder): boolean {
  if (order.status === 'failed') return true
  return (
    isProviderRejected(order) &&
    (order.status === 'completed' || order.status === 'pending' || order.status === 'processing')
  )
}

export function deliveryStatusLabel(order: DeliveryOrder): string {
  if (order.status === 'completed' && isProviderRejected(order)) {
    return 'Delivered — provider rejected'
  }
  if (order.status === 'completed') return 'Delivered'
  if (order.status === 'failed') {
    if (order.failure_reason === 'insufficient_balance') return 'Failed — insufficient balance'
    return order.failure_reason ?? 'Failed'
  }

  const provider = order.provider_status?.toLowerCase().trim()
  if (provider) {
    if (['delivered', 'completed', 'success', 'successful'].includes(provider)) return 'Delivered'
    if (PROVIDER_FAILED.has(provider)) return 'Delivery failed'
    if (['submitting', 'submitted'].includes(provider)) return 'Sending to provider…'
    if (['processing', 'in_progress', 'in-progress', 'pending'].includes(provider)) {
      return 'Delivering…'
    }
    return order.provider_status!.replace(/_/g, ' ')
  }

  return STATUS_HINT[order.status] ?? order.status
}

export function deliveryStatusTone(order: DeliveryOrder): 'success' | 'warning' | 'danger' | 'muted' {
  const label = deliveryStatusLabel(order).toLowerCase()
  if (label.includes('rejected') || label.includes('fail') || label.includes('insufficient')) {
    return 'danger'
  }
  if (label.includes('delivered') && !label.includes('delivering')) return 'success'
  if (label.includes('deliver') || label.includes('send') || label.includes('process')) return 'warning'
  return 'muted'
}

export const DELIVERY_STATUS_HINT = STATUS_HINT
