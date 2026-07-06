import {
  Activity,
  BookOpen,
  Key,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Send,
  Settings,
  Shield,
  ShoppingBag,
  Wallet,
  X,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { NAV_ITEMS } from '../../lib/constants'
import { useAuth } from '../../context/AuthContext'

const ICONS = {
  LayoutDashboard,
  Wallet,
  Send,
  ShoppingBag,
  Package,
  Activity,
  Key,
  BookOpen,
  Settings,
}

interface SidebarProps {
  open: boolean
  onClose: () => void
  onSignOut: () => void
}

export function Sidebar({ open, onClose, onSignOut }: SidebarProps) {
  const { pathname } = useLocation()
  const { user } = useAuth()

  const isActive = (to: string) => {
    if (to === '/dashboard') return pathname === '/dashboard'
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
        className={`fixed inset-y-0 left-0 z-50 w-72 h-screen flex flex-col border-r border-white/10 bg-[#08080c] transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-5 flex items-center gap-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-32 blur-[50px] pointer-events-none bg-amber-500/8" />
          <div className="relative shrink-0">
            <div className="p-2 rounded-xl border border-white/10 bg-white/5 shadow-sm">
              <div className="w-8 h-8 rounded-lg bg-primary grid place-items-center font-black text-primary-foreground text-lg">
                S
              </div>
            </div>
          </div>
          <div className="relative min-w-0">
            <p className="font-display font-bold text-lg text-gradient-yellow truncate">
              SwiftData Reseller
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">API Platform</p>
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
          {NAV_ITEMS.map((item) => {
            const Icon = ICONS[item.icon]
            const active = isActive(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary/15 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {user?.is_admin && (
          <div className="px-3 pb-2">
            <Link
              to="/admin"
              onClick={onClose}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 transition-colors"
            >
              <Shield className="h-4 w-4 shrink-0" />
              Admin Panel
            </Link>
          </div>
        )}

        <div className="p-4 border-t border-white/10">
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

export function DashboardHeader({
  title,
  onMenuOpen,
  balance,
}: {
  title: string
  onMenuOpen: () => void
  balance: number
}) {
  return (
    <header className="h-16 shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 border-b border-white/10 bg-black/40 backdrop-blur-xl z-30">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          className="md:hidden h-9 w-9 rounded-xl bg-white/5 border border-white/10 grid place-items-center"
          onClick={onMenuOpen}
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <span className="font-display font-bold text-base">{title}</span>
          <span className="ml-2 text-[10px] font-black uppercase border border-primary/30 text-primary px-2 py-0.5 rounded-full">
            API User
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-2 sm:px-3 py-1.5">
          <Wallet className="h-4 w-4 text-primary shrink-0" />
          <span className="font-black text-sm">₵{balance.toFixed(2)}</span>
        </div>
      </div>
    </header>
  )
}
