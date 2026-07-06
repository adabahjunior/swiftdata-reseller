import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useAutoDeliverPoll } from '../../hooks/useAutoDeliverPoll'
import { OrderTrackerFab } from './OrderTrackerFab'
import { DashboardHeader, Sidebar } from './Sidebar'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Overview',
  '/dashboard/balance': 'My API Balance',
  '/dashboard/place-order': 'Place Order',
  '/dashboard/orders': 'All Orders',
  '/dashboard/packages': 'Data Packages',
  '/dashboard/health': 'API Health',
  '/dashboard/api': 'My API',
  '/dashboard/docs': 'Documentation',
  '/dashboard/settings': 'Settings',
}

export function DashboardLayout() {
  const { user, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useAutoDeliverPoll()

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground bg-[#050508]">
        Loading…
      </div>
    )
  }

  if (!user) {
    navigate('/auth', { replace: true })
    return null
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth', { replace: true })
  }

  const title = PAGE_TITLES[pathname] ?? 'Dashboard'

  return (
    <div className="min-h-screen h-screen flex w-full bg-[#050508] overflow-hidden">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onSignOut={handleSignOut} />

      <div className="flex-1 flex flex-col min-w-0 md:ml-72 h-screen">
        <DashboardHeader
          title={title}
          onMenuOpen={() => setMenuOpen(true)}
          balance={user.wallet_balance}
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
      <OrderTrackerFab />
    </div>
  )
}
