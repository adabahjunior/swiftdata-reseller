import {
  API_NETWORK_LABELS,
  LEGACY_NETWORK_MAP,
  PACKAGE_NETWORK_LABELS,
  dbNetworkToApi,
} from './constants'

export function formatCurrency(amount: number) {
  return `₵${amount.toFixed(2)}`
}

export function normalizePackageNetworkId(network: string): string {
  return LEGACY_NETWORK_MAP[network] ?? network
}

/** Format network for dashboard orders/packages (DB ids → labels) */
export function formatNetwork(network: string) {
  const id = normalizePackageNetworkId(network)
  return PACKAGE_NETWORK_LABELS[id] ?? network
}

/** Format network for API context (DB id → API id + label) */
export function formatApiNetwork(network: string) {
  const apiId = dbNetworkToApi(normalizePackageNetworkId(network))
  return API_NETWORK_LABELS[apiId] ?? apiId
}

export function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function generateApiKey() {
  const segment = crypto.randomUUID().replace(/-/g, '')
  return `sk_live_${segment}`
}

export function generateOrderReference() {
  return `ORD-${Date.now().toString(36).toUpperCase()}`
}
