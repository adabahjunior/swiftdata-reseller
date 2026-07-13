import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminProtectedRoute } from './components/admin/AdminProtectedRoute'
import { DashboardLayout } from './components/dashboard/DashboardLayout'
import { AdminLayout } from './components/admin/AdminLayout'
import AuthPage from './pages/AuthPage'
import OverviewPage from './pages/dashboard/OverviewPage'
import ApiBalancePage from './pages/dashboard/ApiBalancePage'
import PlaceOrderPage from './pages/dashboard/PlaceOrderPage'
import OrdersPage from './pages/dashboard/OrdersPage'
import DataPackagesPage from './pages/dashboard/DataPackagesPage'
import ApiHealthPage from './pages/dashboard/ApiHealthPage'
import MyApiPage from './pages/dashboard/MyApiPage'
import DocumentationPage from './pages/dashboard/DocumentationPage'
import SettingsPage from './pages/dashboard/SettingsPage'
import VerifyNumbersPage from './pages/dashboard/VerifyNumbersPage'
import AdminOverviewPage from './pages/admin/AdminOverviewPage'
import AdminOrdersPage from './pages/admin/AdminOrdersPage'
import AdminNumberVerificationsPage from './pages/admin/AdminNumberVerificationsPage'
import AdminPackagesPage from './pages/admin/AdminPackagesPage'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import AdminUserDetailPage from './pages/admin/AdminUserDetailPage'
import AdminNotificationsPage from './pages/admin/AdminNotificationsPage'
import AdminSiteSettingsPage from './pages/admin/AdminSiteSettingsPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/auth" replace />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="balance" element={<ApiBalancePage />} />
              <Route path="place-order" element={<PlaceOrderPage />} />
              <Route path="verify-numbers" element={<VerifyNumbersPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="packages" element={<DataPackagesPage />} />
              <Route path="health" element={<ApiHealthPage />} />
              <Route path="api" element={<MyApiPage />} />
              <Route path="docs" element={<DocumentationPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route element={<AdminProtectedRoute />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOverviewPage />} />
              <Route path="orders" element={<AdminOrdersPage />} />
              <Route path="verifications" element={<AdminNumberVerificationsPage />} />
              <Route path="packages" element={<AdminPackagesPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="users/:userId" element={<AdminUserDetailPage />} />
              <Route path="notifications" element={<AdminNotificationsPage />} />
              <Route path="settings" element={<AdminSiteSettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
