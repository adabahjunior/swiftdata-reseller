export const API_BASE_URL = 'https://ihrvvniomtoofrjkmalb.supabase.co/functions/v1/api'

export const MANUAL_TOPUP = {
  phone: '0246360392',
  network: 'MTN Mobile Money',
  name: 'Manfred Sunu Senyo Kwami',
} as const

/** Network IDs stored in database (packages & orders) */
export const PACKAGE_NETWORKS = [
  { id: 'mtn', label: 'MTN' },
  { id: 'at_ishare', label: 'AirtelTigo iShare' },
  { id: 'at_bigtime', label: 'AirtelTigo Bigtime' },
  { id: 'telecel', label: 'Telecel' },
] as const

/** Network IDs exposed in API documentation & responses */
export const API_NETWORKS = [
  { id: 'yello', label: 'Yello' },
  { id: 'at_ishare', label: 'AirtelTigo iShare' },
  { id: 'at_bigtime', label: 'AirtelTigo Bigtime' },
  { id: 'telecel', label: 'Telecel' },
] as const

/** @deprecated use PACKAGE_NETWORKS or API_NETWORKS */
export const NETWORKS = PACKAGE_NETWORKS

export type PackageNetworkId = (typeof PACKAGE_NETWORKS)[number]['id']
export type ApiNetworkId = (typeof API_NETWORKS)[number]['id']

/** DB network → API-facing network id */
export function dbNetworkToApi(dbNetwork: string): string {
  if (dbNetwork === 'mtn') return 'yello'
  return dbNetwork
}

/** API network id → DB network (for package lookup) */
export function apiNetworkToDb(apiNetwork: string): string {
  if (apiNetwork === 'yello') return 'mtn'
  return apiNetwork
}

export const PACKAGE_NETWORK_LABELS: Record<string, string> = Object.fromEntries(
  PACKAGE_NETWORKS.map((n) => [n.id, n.label]),
)

export const API_NETWORK_LABELS: Record<string, string> = Object.fromEntries(
  API_NETWORKS.map((n) => [n.id, n.label]),
)

/** Legacy IDs mapped to package network ids */
export const LEGACY_NETWORK_MAP: Record<string, string> = {
  yellow: 'mtn',
  yello: 'mtn',
  airteltigo_ishare: 'at_ishare',
  airteltigo_bigtime: 'at_bigtime',
}

export const NETWORK_LABELS = PACKAGE_NETWORK_LABELS

export const NETWORK_COLORS: Record<string, string> = {
  mtn: 'text-primary border-primary/30 bg-primary/10',
  yello: 'text-primary border-primary/30 bg-primary/10',
  at_ishare: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
  at_bigtime: 'text-indigo-400 border-indigo-400/30 bg-indigo-400/10',
  telecel: 'text-red-400 border-red-400/30 bg-red-400/10',
}

export const ORDER_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  processing: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-400 border-red-500/30',
}

export const NAV_ITEMS = [
  { label: 'Overview', to: '/dashboard', icon: 'LayoutDashboard' },
  { label: 'My API Balance', to: '/dashboard/balance', icon: 'Wallet' },
  { label: 'Place Order', to: '/dashboard/place-order', icon: 'Send' },
  { label: 'Verify Numbers', to: '/dashboard/verify-numbers', icon: 'ShieldCheck' },
  { label: 'All Orders', to: '/dashboard/orders', icon: 'ShoppingBag' },
  { label: 'Data Packages', to: '/dashboard/packages', icon: 'Package' },
  { label: 'API Health', to: '/dashboard/health', icon: 'Activity' },
  { label: 'My API', to: '/dashboard/api', icon: 'Key' },
  { label: 'Documentation', to: '/dashboard/docs', icon: 'BookOpen' },
  { label: 'Settings', to: '/dashboard/settings', icon: 'Settings' },
] as const
