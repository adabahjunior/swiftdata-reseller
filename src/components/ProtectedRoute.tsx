import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ProtectedRoute() {
  const { user, loading, signOut } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  if (user.is_active === false) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="font-display font-bold text-2xl">Account Deactivated</h1>
          <p className="text-muted-foreground text-sm">
            Your account has been deactivated. Contact support if you believe this is an error.
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-sm font-bold text-primary hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return <Outlet />
}
