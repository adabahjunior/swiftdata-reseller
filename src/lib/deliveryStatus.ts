type DeliveryOrder = {
  status: string
  provider_status?: string | null
  failure_reason?: string | null
}

const STATUS_HINT: Record<string, string> = {
  pending: 'Waiting to be sent to provider',
  processing: 'Being delivered',
  completed: 'Delivered successfully',
  failed: 'Order failed',
}

export function deliveryStatusLabel(order: DeliveryOrder): string {
  if (order.status === 'completed') return 'Delivered'
  if (order.status === 'failed') {
    if (order.failure_reason === 'insufficient_balance') return 'Failed — insufficient balance'
    return order.failure_reason ?? 'Failed'
  }

  const provider = order.provider_status?.toLowerCase().trim()
  if (provider) {
    if (['delivered', 'completed', 'success', 'successful'].includes(provider)) return 'Delivered'
    if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(provider)) {
      return 'Delivery failed'
    }
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
  if (label.includes('delivered') && !label.includes('delivering')) return 'success'
  if (label.includes('fail') || label.includes('insufficient')) return 'danger'
  if (label.includes('deliver') || label.includes('send') || label.includes('process')) return 'warning'
  return 'muted'
}

export const DELIVERY_STATUS_HINT = STATUS_HINT
