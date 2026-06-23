import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { DashboardHeader, Sidebar } from './Sidebar'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Overview',
  '/dashboard/balance': 'My API Balance',
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
    <div className="min-h-screen flex w-full bg-[#050508]">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} onSignOut={handleSignOut} />

      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader
          title={title}
          onMenuOpen={() => setMenuOpen(true)}
          balance={user.wallet_balance}
        />

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
          <div className="max-w-6xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
