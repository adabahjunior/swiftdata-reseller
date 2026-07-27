import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import AdminOrderExportsPanel from '../../components/admin/AdminOrderExportsPanel'
import { useAuth } from '../../context/AuthContext'
import { useAdminOrders } from '../../hooks/useAdminData'
import { deliveryStatusLabel, deliveryStatusTone } from '../../lib/deliveryStatus'
import { triggerOrderFulfillment } from '../../lib/providerFulfillment'
import { triggerProviderStatusSync } from '../../lib/providerStatusSync'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'
import type { Order } from '../../types/database'

const ORDER_STATUSES: Order['status'][] = ['pending', 'processing', 'completed', 'failed']

const STATUS_LABELS: Record<Order['status'], string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Delivered',
  failed: 'Failed',
}

const PROVIDER_TONE: Record<ReturnType<typeof deliveryStatusTone>, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  danger: 'border-red-500/30 bg-red-500/10 text-red-400',
  muted: 'border-white/10 bg-white/5 text-muted-foreground',
}

export default function AdminOrdersPage() {
  const { user: admin } = useAuth()
  const { orders, loading, refresh } = useAdminOrders()
  const [statusFilter, setStatusFilter] = useState('all')
  const [updating, setUpdating] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<Order['status']>('completed')
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const filtered = useMemo(
    () => orders.filter((o) => statusFilter === 'all' || o.status === statusFilter),
    [orders, statusFilter],
  )

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((o) => selected.has(o.id))

  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        filtered.forEach((o) => next.delete(o.id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        filtered.forEach((o) => next.add(o.id))
        return next
      })
    }
  }

  const selectByStatus = (status: Order['status']) => {
    setStatusFilter(status)
    setSelected(new Set(orders.filter((o) => o.status === status).map((o) => o.id)))
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyStatusUpdate = async (ids: string[], status: Order['status']) => {
    if (ids.length === 0) return

    const payload = {
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    }

    const { error } = await supabase.from('orders').update(payload).in('id', ids)
    if (error) throw error
  }

  const retryOrder = async (orderId: string) => {
    if (!admin) return
    setRetryingId(orderId)
    setMessage(null)

    const { data, error } = await supabase.rpc('admin_retry_failed_order', {
      p_admin_id: admin.id,
      p_order_id: orderId,
    })

    setRetryingId(null)

    if (error || !data?.success) {
      setMessage(error?.message ?? data?.error ?? 'Retry failed')
      return
    }

    setMessage(`Order ${data.order.reference} retried and queued for provider.`)
    if (data.order?.id) void triggerOrderFulfillment(data.order.id)
    triggerProviderStatusSync()
    await refresh()
  }

  const retryFailedOrders = async (ids: string[]) => {
    if (!admin || ids.length === 0) return

    setBulkUpdating(true)
    setMessage(null)

    let succeeded = 0
    let failed = 0
    const errors: string[] = []

    for (const orderId of ids) {
      const { data, error } = await supabase.rpc('admin_retry_failed_order', {
        p_admin_id: admin.id,
        p_order_id: orderId,
      })

      if (error || !data?.success) {
        failed += 1
        errors.push(error?.message ?? data?.error ?? orderId)
        continue
      }

      succeeded += 1
      if (data.order?.id) void triggerOrderFulfillment(String(data.order.id))
    }

    triggerProviderStatusSync()
    setBulkUpdating(false)
    setSelected(new Set())

    if (failed === 0) {
      setMessage(`Retried ${succeeded} failed order(s) and queued them for the provider.`)
    } else {
      setMessage(
        `Retried ${succeeded}, ${failed} failed. ${errors[0] ?? ''}`.trim(),
      )
    }
    await refresh()
  }

  const failedIds = useMemo(
    () => orders.filter((o) => o.status === 'failed').map((o) => o.id),
    [orders],
  )

  const selectedFailedIds = useMemo(
    () => [...selected].filter((id) => orders.some((o) => o.id === id && o.status === 'failed')),
    [selected, orders],
  )

  const updateStatus = async (orderId: string, status: Order['status']) => {
    setUpdating(orderId)
    setMessage(null)
    await applyStatusUpdate([orderId], status)
    setUpdating(null)
    await refresh()
  }

  const bulkUpdateStatus = async (status: Order['status'] = bulkStatus) => {
    const ids = [...selected]
    if (ids.length === 0) return

    setBulkUpdating(true)
    setMessage(null)

    try {
      await applyStatusUpdate(ids, status)
      setMessage(`Updated ${ids.length} order(s) to ${STATUS_LABELS[status]}.`)
      setSelected(new Set())
      await refresh()
    } catch (e) {
      setMessage((e as Error).message ?? 'Bulk update failed')
    } finally {
      setBulkUpdating(false)
    }
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Orders"
        description="All API orders across users — bulk update status or export to Excel."
      />

      <AdminOrderExportsPanel />

      <Panel title="All Orders" description={`${filtered.length} order(s) · ${selected.size} selected`}>
        <div className="flex flex-col gap-4 mb-4">
          <div className="flex flex-wrap gap-3 items-center">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setSelected(new Set())
              }}
              className="h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            >
              <option value="all">All statuses</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => selectByStatus('processing')}
              className="h-10 px-3 rounded-lg border border-white/10 text-sm hover:bg-white/5"
            >
              Select all processing
            </button>
            <button
              type="button"
              onClick={() => selectByStatus('completed')}
              className="h-10 px-3 rounded-lg border border-white/10 text-sm hover:bg-white/5"
            >
              Select all delivered
            </button>
            <button
              type="button"
              onClick={() => selectByStatus('failed')}
              className="h-10 px-3 rounded-lg border border-white/10 text-sm hover:bg-white/5"
            >
              Select all failed
            </button>
            <button
              type="button"
              disabled={bulkUpdating || failedIds.length === 0}
              onClick={() => void retryFailedOrders(failedIds)}
              className="h-10 px-3 rounded-lg border border-primary/30 bg-primary/10 text-primary text-sm font-bold hover:bg-primary/20 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${bulkUpdating ? 'animate-spin' : ''}`} />
              {bulkUpdating ? 'Retrying…' : `Retry all failed (${failedIds.length})`}
            </button>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="h-10 px-3 rounded-lg text-sm text-muted-foreground hover:text-foreground"
              >
                Clear selection
              </button>
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap gap-3 items-center rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <span className="text-sm font-medium">{selected.size} order(s) selected</span>
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value as Order['status'])}
                className="h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
              >
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={bulkUpdating}
                onClick={() => void bulkUpdateStatus()}
                className="h-10 px-4 rounded-lg bg-red-500 text-white text-sm font-bold hover:bg-red-600 disabled:opacity-50"
              >
                {bulkUpdating ? 'Updating…' : 'Apply to selected'}
              </button>
              <button
                type="button"
                disabled={bulkUpdating}
                onClick={() => void bulkUpdateStatus('completed')}
                className="h-10 px-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-sm font-bold hover:bg-emerald-500/20 disabled:opacity-50"
              >
                Mark delivered
              </button>
              <button
                type="button"
                disabled={bulkUpdating}
                onClick={() => void bulkUpdateStatus('processing')}
                className="h-10 px-4 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 text-sm font-bold hover:bg-blue-500/20 disabled:opacity-50"
              >
                Mark processing
              </button>
              {selectedFailedIds.length > 0 && (
                <button
                  type="button"
                  disabled={bulkUpdating}
                  onClick={() => void retryFailedOrders(selectedFailedIds)}
                  className="h-10 px-4 rounded-lg border border-primary/30 bg-primary/10 text-primary text-sm font-bold hover:bg-primary/20 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${bulkUpdating ? 'animate-spin' : ''}`} />
                  Retry selected failed ({selectedFailedIds.length})
                </button>
              )}
            </div>
          )}

          {message && (
            <p className={`text-sm rounded-lg px-4 py-2 border ${
              message.includes('failed') || message.includes('Insufficient') || message.includes('Unauthorized')
                ? 'text-red-400 bg-red-500/10 border-red-500/20'
                : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
            }`}>
              {message}
            </p>
          )}
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
                  <th className="px-5 md:px-6 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAllFiltered}
                      aria-label="Select all visible orders"
                      className="rounded border-white/20"
                    />
                  </th>
                  <th className="px-5 md:px-6 py-3 font-medium">Reference</th>
                  <th className="px-5 md:px-6 py-3 font-medium">User</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Phone</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Network</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Amount</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Source</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Provider</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Status</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Exported</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Date</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filtered.map((order) => (
                  <tr
                    key={order.id}
                    className={`hover:bg-white/[0.02] ${selected.has(order.id) ? 'bg-white/[0.04]' : ''}`}
                  >
                    <td className="px-5 md:px-6 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(order.id)}
                        onChange={() => toggleOne(order.id)}
                        aria-label={`Select ${order.reference}`}
                        className="rounded border-white/20"
                      />
                    </td>
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
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                          order.order_source === 'dashboard'
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-white/10 bg-white/5 text-muted-foreground'
                        }`}
                      >
                        {order.order_source === 'dashboard' ? 'Dashboard' : 'API'}
                      </span>
                    </td>
                    <td className="px-5 md:px-6 py-3">
                      {order.provider_submitted_at || order.provider_status ? (
                        <div>
                          {order.provider_name && (
                            <p className="text-xs font-medium text-foreground/90 mb-1">{order.provider_name}</p>
                          )}
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                              PROVIDER_TONE[deliveryStatusTone(order)]
                            }`}
                          >
                            {deliveryStatusLabel(order)}
                          </span>
                          {order.provider_error && (
                            <p className="text-[10px] text-red-400 mt-1 max-w-[140px] truncate" title={order.provider_error}>
                              {order.provider_error}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not sent</span>
                      )}
                    </td>
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
                      <div className="flex flex-col gap-2">
                        <select
                          value={order.status}
                          disabled={updating === order.id || bulkUpdating || retryingId === order.id}
                          onChange={(e) => updateStatus(order.id, e.target.value as Order['status'])}
                          className="h-8 rounded-lg border border-white/10 bg-secondary/50 px-2 text-xs outline-none"
                        >
                          {ORDER_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                        {order.status === 'failed' && (
                          <button
                            type="button"
                            disabled={retryingId === order.id || bulkUpdating}
                            onClick={() => void retryOrder(order.id)}
                            className="inline-flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg border border-primary/30 bg-primary/10 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${retryingId === order.id ? 'animate-spin' : ''}`} />
                            Retry
                          </button>
                        )}
                      </div>
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
