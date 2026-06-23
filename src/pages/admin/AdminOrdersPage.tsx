import { useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import AdminOrderExportsPanel from '../../components/admin/AdminOrderExportsPanel'
import { useAdminOrders } from '../../hooks/useAdminData'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'
import type { Order } from '../../types/database'

export default function AdminOrdersPage() {
  const { orders, loading, refresh } = useAdminOrders()
  const [statusFilter, setStatusFilter] = useState('all')
  const [updating, setUpdating] = useState<string | null>(null)

  const filtered = orders.filter((o) => statusFilter === 'all' || o.status === statusFilter)

  const updateStatus = async (orderId: string, status: Order['status']) => {
    setUpdating(orderId)
    await supabase
      .from('orders')
      .update({
        status,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
      })
      .eq('id', orderId)
    setUpdating(null)
    await refresh()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Orders"
        description="All API orders across users — updates live. Export batches of up to 50 orders to Excel."
      />

      <AdminOrderExportsPanel />

      <Panel title="All Orders" description={`${filtered.length} order(s)`}>
        <div className="mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
          >
            <option value="all">All statuses</option>
            {['pending', 'processing', 'completed', 'failed'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading orders…</p>
        ) : filtered.length === 0 ? (
          <EmptyState title="No orders" description="No orders match your filter." />
        ) : (
          <div className="overflow-x-auto -mx-5 md:-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="px-5 md:px-6 py-3 font-medium">Reference</th>
                  <th className="px-5 md:px-6 py-3 font-medium">User</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Phone</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Network</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Amount</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Status</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Exported</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Date</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filtered.map((order) => (
                  <tr key={order.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 md:px-6 py-3 font-mono text-xs">{order.reference}</td>
                    <td className="px-5 md:px-6 py-3">
                      <p className="font-medium truncate max-w-[120px]">
                        {order.profile?.full_name ?? '—'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate max-w-[120px]">
                        {order.profile?.email}
                      </p>
                    </td>
                    <td className="px-5 md:px-6 py-3">{order.phone}</td>
                    <td className="px-5 md:px-6 py-3">{formatNetwork(order.network)}</td>
                    <td className="px-5 md:px-6 py-3 font-bold">{formatCurrency(Number(order.amount))}</td>
                    <td className="px-5 md:px-6 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-5 md:px-6 py-3">
                      {order.export_download_id ? (
                        <span className="text-xs text-emerald-400">Yes</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No</span>
                      )}
                    </td>
                    <td className="px-5 md:px-6 py-3 text-muted-foreground whitespace-nowrap text-xs">
                      {formatDate(order.created_at)}
                    </td>
                    <td className="px-5 md:px-6 py-3">
                      <select
                        value={order.status}
                        disabled={updating === order.id}
                        onChange={(e) => updateStatus(order.id, e.target.value as Order['status'])}
                        className="h-8 rounded-lg border border-white/10 bg-secondary/50 px-2 text-xs outline-none"
                      >
                        {['pending', 'processing', 'completed', 'failed'].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
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
