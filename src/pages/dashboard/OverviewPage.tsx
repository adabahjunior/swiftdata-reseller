import { Activity, ArrowRight, CheckCircle2, Key, Package, Send, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader, StatCard, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { MANUAL_TOPUP } from '../../lib/constants'
import { useApiKeys, useApiLogs, useOrders } from '../../hooks/useDashboardData'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'

export default function OverviewPage() {
  const { user } = useAuth()
  const { orders, allOrders, loading: ordersLoading } = useOrders(5)
  const { keys } = useApiKeys()
  const { logs } = useApiLogs(100)

  const firstName = user?.full_name.split(' ')[0]
  const completedOrders = allOrders.filter((o) => o.status === 'completed').length
  const successRate =
    allOrders.length > 0 ? Math.round((completedOrders / allOrders.length) * 100) : 100
  const avgResponse =
    logs.length > 0
      ? Math.round(logs.reduce((sum, log) => sum + log.response_time_ms, 0) / logs.length)
      : 0
  const activeKeys = keys.filter((k) => k.is_active).length

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title={`Welcome back${firstName ? `, ${firstName}` : ''} 👋`}
        description="Monitor your API balance, orders, and platform health — all purchases happen via API."
        action={
          <Link
            to="/dashboard/api"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-primary text-primary-foreground font-black shadow-lg shadow-primary/25 shrink-0"
          >
            <Key className="h-5 w-5" />
            Get API Key
          </Link>
        }
      />

      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase text-primary tracking-wider mb-1">Manual Top-Up Code</p>
          <p className="text-sm text-muted-foreground">
            Send MoMo to <strong className="text-foreground">{MANUAL_TOPUP.phone}</strong> ({MANUAL_TOPUP.network}) and use your code as reference.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-black text-3xl tracking-[0.25em] text-primary font-mono">{user?.topup_code ?? '-----'}</span>
          <Link to="/dashboard/balance" className="text-sm font-bold text-primary hover:underline">
            Details →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="API Balance" value={formatCurrency(user?.wallet_balance ?? 0)} accent />
        <StatCard label="Total Orders" value={String(allOrders.length)} sub="Via API" />
        <StatCard label="Success Rate" value={`${successRate}%`} sub={`${completedOrders} completed`} />
        <StatCard label="Active API Keys" value={String(activeKeys)} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-lg">Recent API Orders</h2>
            <Link to="/dashboard/orders" className="text-sm text-primary font-bold hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {ordersLoading ? (
            <p className="text-sm text-muted-foreground">Loading orders…</p>
          ) : orders.length === 0 ? (
            <EmptyState
              title="No orders yet"
              description="Orders appear here when you purchase data through the API. Check Documentation to get started."
            />
          ) : (
            <ul className="divide-y divide-white/10">
              {orders.map((order) => (
                <li key={order.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{order.reference}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatNetwork(order.network)} · {order.size_gb}GB · {order.phone}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <StatusBadge status={order.status} />
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(order.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <span className="font-bold text-emerald-400">API Operational</span>
            </div>
            <p className="text-sm text-muted-foreground">
              All endpoints responding normally.
              {avgResponse > 0 && ` Avg response: ${avgResponse}ms.`}
            </p>
            <Link to="/dashboard/health" className="text-sm text-primary font-bold mt-3 inline-block hover:underline">
              View health details →
            </Link>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="font-display font-bold mb-3">Quick Links</h3>
            <div className="space-y-2">
              {[
                { to: '/dashboard/place-order', icon: Send, label: 'Place Order' },
                { to: '/dashboard/packages', icon: Package, label: 'Browse Packages' },
                { to: '/dashboard/docs', icon: Activity, label: 'API Documentation' },
                { to: '/dashboard/balance', icon: Wallet, label: 'Top Up Balance' },
              ].map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
                >
                  <link.icon className="h-4 w-4 text-primary" />
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
