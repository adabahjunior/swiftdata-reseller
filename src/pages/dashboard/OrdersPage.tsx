import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { useOrders } from '../../hooks/useDashboardData'
import { PACKAGE_NETWORKS } from '../../lib/constants'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'
import { triggerOrderFulfillment } from '../../lib/providerFulfillment'
import { triggerProviderStatusSync } from '../../lib/providerStatusSync'
import { supabase } from '../../lib/supabase'

export default function OrdersPage() {
  const { user, refreshProfile } = useAuth()
  const { orders, loading, refresh } = useOrders()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [networkFilter, setNetworkFilter] = useState<string>('all')
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const filtered = useMemo(() => {
    return orders.filter((order) => {
      if (statusFilter !== 'all' && order.status !== statusFilter) return false
      if (networkFilter !== 'all' && order.network !== networkFilter) return false
      return true
    })
  }, [orders, statusFilter, networkFilter])

  const retryOrder = async (orderId: string) => {
    if (!user) return
    setRetryingId(orderId)
    setMessage(null)

    const { data, error } = await supabase.rpc('retry_failed_order', {
      p_user_id: user.id,
      p_order_id: orderId,
    })

    setRetryingId(null)

    if (error || !data?.success) {
      setMessage(error?.message ?? data?.error ?? 'Retry failed')
      return
    }

    setMessage('Order completed successfully and sent for processing.')
    // Single-order path only — avoid also calling /process (duplicate provider purchases)
    if (data.order?.id) void triggerOrderFulfillment(data.order.id)
    triggerProviderStatusSync()
    await Promise.all([refresh(), refreshProfile()])
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="All Orders"
        description="Every data purchase made through your API keys. Failed orders can be retried after topping up."
      />

      {message && (
        <p className="text-sm rounded-lg border border-primary/30 bg-primary/5 text-primary px-4 py-2">
          {message}
        </p>
      )}

      <Panel title="Order History" description={`${filtered.length} order(s)`}>
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
            className="h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
          >
            <option value="all">All networks</option>
            {PACKAGE_NETWORKS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading orders…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No orders found"
            description="Orders created via the API will show up here with status, network, and delivery details."
          />
        ) : (
          <div className="overflow-x-auto -mx-5 md:-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="px-5 md:px-6 py-3 font-medium">Reference</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Phone</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Network</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Size</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Amount</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Status</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Date</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filtered.map((order) => (
                  <tr key={order.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 md:px-6 py-3 font-mono text-xs">{order.reference}</td>
                    <td className="px-5 md:px-6 py-3">{order.phone}</td>
                    <td className="px-5 md:px-6 py-3">{formatNetwork(order.network)}</td>
                    <td className="px-5 md:px-6 py-3">{order.size_gb} GB</td>
                    <td className="px-5 md:px-6 py-3 font-bold">{formatCurrency(Number(order.amount))}</td>
                    <td className="px-5 md:px-6 py-3">
                      <StatusBadge status={order.status} />
                      {order.provider_status &&
                        order.status !== 'completed' &&
                        order.status !== 'failed' && (
                          <p className="text-[10px] text-muted-foreground mt-1 capitalize">
                            Live: {order.provider_status.replace(/_/g, ' ')}
                          </p>
                        )}
                      {order.status === 'failed' && order.failure_reason === 'insufficient_balance' && (
                        <p className="text-[10px] text-muted-foreground mt-1">Insufficient balance</p>
                      )}
                    </td>
                    <td className="px-5 md:px-6 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(order.created_at)}
                    </td>
                    <td className="px-5 md:px-6 py-3">
                      {order.status === 'failed' ? (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            disabled={retryingId === order.id}
                            onClick={() => void retryOrder(order.id)}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-primary/30 bg-primary/10 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${retryingId === order.id ? 'animate-spin' : ''}`} />
                            Retry
                          </button>
                          <Link
                            to="/dashboard/balance"
                            className="text-[10px] text-muted-foreground hover:text-primary underline"
                          >
                            Top up balance
                          </Link>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
