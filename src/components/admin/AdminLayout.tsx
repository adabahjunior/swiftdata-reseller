import {
  ArrowLeft,
  Bell,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingBag,
  Users,
  X,
} from 'lucide-react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { ADMIN_NAV_ITEMS, ADMIN_PAGE_TITLES } from '../../lib/adminConstants'

const ICONS = {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Users,
  Bell,
  Settings,
}

function AdminSidebar({
  open,
  onClose,
  onSignOut,
}: {
  open: boolean
  onClose: () => void
  onSignOut: () => void
}) {
  const { pathname } = useLocation()

  const isActive = (to: string) => {
    if (to === '/admin') return pathname === '/admin'
    return pathname.startsWith(to)
  }

  return (
    <>
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onClose}
          aria-label="Close menu"
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-72 flex flex-col border-r border-red-500/20 bg-[#0a0808] transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-5 flex items-center gap-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-32 blur-[50px] pointer-events-none bg-red-500/10" />
          <div className="relative shrink-0">
            <div className="p-2 rounded-xl border border-red-500/20 bg-red-500/5 shadow-sm">
              <div className="w-8 h-8 rounded-lg bg-red-500 grid place-items-center font-black text-white text-lg">
                A
              </div>
            </div>
          </div>
          <div className="relative min-w-0">
            <p className="font-display font-bold text-lg text-red-400 truncate">Admin Panel</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
              SwiftData Reseller
            </p>
          </div>
          <button
            type="button"
            className="md:hidden ml-auto h-9 w-9 rounded-lg border border-white/10 grid place-items-center"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {ADMIN_NAV_ITEMS.map((item) => {
            const Icon = ICONS[item.icon]
            const active = isActive(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-1">
          <Link
            to="/dashboard"
            onClick={onClose}
            className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            User Dashboard
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  )
}

export function AdminLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth', { replace: true })
  }

  const title = ADMIN_PAGE_TITLES[pathname] ?? 'Admin'

  return (
    <div className="min-h-screen flex w-full bg-[#050508]">
      <AdminSidebar open={menuOpen} onClose={() => setMenuOpen(false)} onSignOut={handleSignOut} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex items-center justify-between gap-3 px-4 md:px-6 border-b border-red-500/10 bg-black/40 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="md:hidden h-9 w-9 rounded-xl bg-white/5 border border-white/10 grid place-items-center"
              onClick={() => setMenuOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <span className="font-display font-bold text-base">{title}</span>
              <span className="ml-2 text-[10px] font-black uppercase border border-red-500/30 text-red-400 px-2 py-0.5 rounded-full">
                Admin
              </span>
            </div>
          </div>
          <div className="text-sm text-muted-foreground truncate hidden sm:block">
            {user?.full_name || user?.email}
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
