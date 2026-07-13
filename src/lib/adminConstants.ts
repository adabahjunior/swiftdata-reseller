export const ADMIN_NAV_ITEMS = [
  { label: 'Overview', to: '/admin', icon: 'LayoutDashboard' },
  { label: 'Orders', to: '/admin/orders', icon: 'ShoppingBag' },
  { label: 'Number Verifications', to: '/admin/verifications', icon: 'ShieldCheck' },
  { label: 'Packages', to: '/admin/packages', icon: 'Package' },
  { label: 'Users', to: '/admin/users', icon: 'Users' },
  { label: 'Notifications', to: '/admin/notifications', icon: 'Bell' },
  { label: 'Site Settings', to: '/admin/settings', icon: 'Settings' },
] as const

export const ADMIN_PAGE_TITLES: Record<string, string> = {
  '/admin': 'Admin Overview',
  '/admin/orders': 'Orders',
  '/admin/verifications': 'Number Verifications',
  '/admin/packages': 'Packages',
  '/admin/users': 'Users',
  '/admin/notifications': 'Notifications',
  '/admin/settings': 'Site Settings',
}
