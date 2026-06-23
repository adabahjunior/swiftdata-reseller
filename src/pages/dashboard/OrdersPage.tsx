import { useMemo, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useOrders } from '../../hooks/useDashboardData'
import { PACKAGE_NETWORKS } from '../../lib/constants'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'

export default function OrdersPage() {
  const { orders, loading } = useOrders()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [networkFilter, setNetworkFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    return orders.filter((order) => {
      if (statusFilter !== 'all' && order.status !== statusFilter) return false
      if (networkFilter !== 'all' && order.network !== networkFilter) return false
      return true
    })
  }, [orders, statusFilter, networkFilter])

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="All Orders"
        description="Every data purchase made through your API keys. New orders appear automatically."
      />

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
                    </td>
                    <td className="px-5 md:px-6 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(order.created_at)}
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
