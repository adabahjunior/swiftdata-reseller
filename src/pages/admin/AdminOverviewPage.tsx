import { Link } from 'react-router-dom'
import { EmptyState, PageHeader, StatCard, StatusBadge } from '../../components/dashboard/ui'
import { useAdminOrders, useAdminStats } from '../../hooks/useAdminData'
import { formatCurrency, formatNetwork } from '../../lib/format'

export default function AdminOverviewPage() {
  const { stats, loading } = useAdminStats()
  const { orders, loading: ordersLoading } = useAdminOrders()

  const recentOrders = orders.slice(0, 8)

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Admin Overview"
        description="Platform-wide metrics for SwiftData Reseller API."
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading stats…</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
          <StatCard label="Total Users" value={String(stats.users)} accent />
          <StatCard label="Total Orders" value={String(stats.orders)} />
          <StatCard label="Revenue" value={formatCurrency(stats.revenue)} />
          <StatCard label="Pending Orders" value={String(stats.pendingOrders)} />
          <StatCard label="Active Packages" value={String(stats.packages)} />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-lg">Recent Orders</h2>
            <Link to="/admin/orders" className="text-sm text-red-400 font-bold hover:underline">
              View all →
            </Link>
          </div>
          {ordersLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : recentOrders.length === 0 ? (
            <EmptyState title="No orders yet" description="Orders from API users will appear here." />
          ) : (
            <ul className="divide-y divide-white/10">
              {recentOrders.map((order) => (
                <li key={order.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{order.reference}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.profile?.full_name ?? order.profile?.email ?? 'Unknown'} ·{' '}
                      {formatNetwork(order.network)} · {order.phone}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <StatusBadge status={order.status} />
                    <p className="text-xs font-bold mt-1">{formatCurrency(Number(order.amount))}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="font-display font-bold text-lg mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {[
              { to: '/admin/packages', label: 'Manage Packages' },
              { to: '/admin/users', label: 'Manage Users' },
              { to: '/admin/notifications', label: 'Send Notification' },
              { to: '/admin/settings', label: 'Site Settings' },
            ].map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="block rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground border border-white/5 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
