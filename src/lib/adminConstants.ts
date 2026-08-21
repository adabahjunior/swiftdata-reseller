import type { NavGroupDef, NavItemDef } from './constants'

export const ADMIN_NAV_GROUPS: NavGroupDef[] = [
  {
    id: 'main',
    label: 'Main',
    items: [{ label: 'Overview', to: '/admin', icon: 'LayoutDashboard' }],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { label: 'Orders', to: '/admin/orders', icon: 'ShoppingBag' },
      { label: 'Refunds', to: '/admin/refunds', icon: 'RotateCcw' },
      { label: 'Number Verifications', to: '/admin/verifications', icon: 'ShieldCheck' },
      { label: 'Tickets', to: '/admin/tickets', icon: 'Ticket' },
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    items: [
      { label: 'Packages', to: '/admin/packages', icon: 'Package' },
      { label: 'Utilities', to: '/admin/utilities', icon: 'Zap' },
      { label: 'Banners', to: '/admin/banners', icon: 'Image' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { label: 'Users', to: '/admin/users', icon: 'Users' },
      { label: 'Notifications', to: '/admin/notifications', icon: 'Bell' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { label: 'Support WhatsApp', to: '/admin/support', icon: 'MessageCircle' },
      { label: 'Site Settings', to: '/admin/settings', icon: 'Settings' },
    ],
  },
]

export const ADMIN_NAV_ITEMS: NavItemDef[] = ADMIN_NAV_GROUPS.flatMap((g) => g.items)

export const ADMIN_PAGE_TITLES: Record<string, string> = {
  '/admin': 'Admin Overview',
  '/admin/orders': 'Orders',
  '/admin/refunds': 'SK Plug Refunds',
  '/admin/verifications': 'Number Verifications',
  '/admin/tickets': 'Support Tickets',
  '/admin/banners': 'Dashboard Banners',
  '/admin/packages': 'Packages',
  '/admin/utilities': 'Utility Products',
  '/admin/users': 'Users',
  '/admin/notifications': 'Notifications',
  '/admin/support': 'Support WhatsApp',
  '/admin/settings': 'Site Settings',
}
