import { Radio, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { deliveryStatusLabel, deliveryStatusTone } from '../../lib/deliveryStatus'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'
import { triggerOrderFulfillment } from '../../lib/providerFulfillment'
import { triggerProviderStatusSync } from '../../lib/providerStatusSync'
import { supabase } from '../../lib/supabase'

type TrackedOrder = {
  id: string
  reference: string
  phone: string
  network: string
  size_gb: number
  amount: number
  status: string
  failure_reason: string | null
  created_at: string
  completed_at: string | null
  provider_status: string | null
  provider_name: string | null
  provider_error: string | null
  provider_submitted_at: string | null
  user_id: string | null
  user_name: string | null
  user_email: string | null
  topup_code: string | null
}

const TONE_CLASSES = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  danger: 'border-red-500/30 bg-red-500/10 text-red-400',
  muted: 'border-white/10 bg-white/5 text-muted-foreground',
} as const

type Mode = 'search' | 'live'

export function AdminOrderTrackerFab() {
  const { user: admin } = useAuth()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('live')
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orders, setOrders] = useState<TrackedOrder[]>([])
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)

  const fetchTracked = useCallback(
    async (opts: { query?: string; liveOnly?: boolean; showLoading?: boolean }) => {
      if (!admin) return
      const liveOnly = Boolean(opts.liveOnly)
      const q = (opts.query ?? '').trim()
      if (!liveOnly && !q) return

      if (opts.showLoading !== false) setLoading(true)
      setError(null)
      triggerProviderStatusSync()

      const { data, error: rpcError } = await supabase.rpc('admin_track_orders', {
        p_admin_id: admin.id,
        p_query: liveOnly ? null : q,
        p_live_only: liveOnly,
      })

      if (opts.showLoading !== false) setLoading(false)

      if (rpcError || !data?.success) {
        setError(rpcError?.message ?? data?.error ?? 'Could not load orders')
        setOrders([])
        return
      }

      const rows = (data.orders as TrackedOrder[]) ?? []
      setOrders(rows)
      setActiveQuery(liveOnly ? '' : q)
      if (rows.length === 0) {
        setError(liveOnly ? 'No live (pending/processing) orders right now.' : 'No orders matched.')
      }
    },
    [admin],
  )

  const runSearch = async () => {
    const q = query.trim()
    if (!q) {
      setError('Enter a phone (024…) or order reference')
      return
    }
    setMode('search')
    setOrders([])
    await fetchTracked({ query: q, liveOnly: false, showLoading: true })
  }

  const runLive = async () => {
    setMode('live')
    setActiveQuery('')
    setOrders([])
    await fetchTracked({ liveOnly: true, showLoading: true })
  }

  const retryOrder = async (orderId: string) => {
    if (!admin) return
    setRetryingId(orderId)
    setRetryMessage(null)

    const { data, error: rpcError } = await supabase.rpc('admin_retry_failed_order', {
      p_admin_id: admin.id,
      p_order_id: orderId,
    })

    setRetryingId(null)

    if (rpcError || !data?.success) {
      setRetryMessage(rpcError?.message ?? data?.error ?? 'Retry failed')
      return
    }

    setRetryMessage(`Order ${data.order.reference} retried and queued for provider.`)
    if (data.order?.id) void triggerOrderFulfillment(String(data.order.id))
    triggerProviderStatusSync()
    if (mode === 'live') {
      await fetchTracked({ liveOnly: true, showLoading: false })
    } else if (activeQuery) {
      await fetchTracked({ query: activeQuery, liveOnly: false, showLoading: false })
    }
  }

  useEffect(() => {
    if (!open || !admin) return

    if (mode === 'live') {
      void fetchTracked({ liveOnly: true, showLoading: true })
    }

    const channel = supabase
      .channel(`admin-order-tracker-${mode}-${activeQuery || 'live'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          const row = (payload.new ?? payload.old) as TrackedOrder | undefined
          if (!row) return

          if (mode === 'live') {
            const isLive = row.status === 'pending' || row.status === 'processing'
            setOrders((prev) => {
              if (payload.eventType === 'DELETE' || !isLive) {
                return prev.filter((o) => o.id !== row.id)
              }
              const exists = prev.some((o) => o.id === row.id)
              if (!exists) return [{ ...row }, ...prev].slice(0, 100)
              return prev.map((o) => (o.id === row.id ? { ...o, ...row } : o))
            })
            return
          }

          const matchesPhone = activeQuery && row.phone === activeQuery
          const matchesRef =
            activeQuery &&
            String(row.reference ?? '')
              .toLowerCase()
              .includes(activeQuery.toLowerCase())
          if (!matchesPhone && !matchesRef) return

          if (payload.eventType === 'DELETE') {
            setOrders((prev) => prev.filter((o) => o.id !== row.id))
            return
          }

          setOrders((prev) => {
            const exists = prev.some((o) => o.id === row.id)
            if (!exists) return [{ ...row }, ...prev]
            return prev.map((o) => (o.id === row.id ? { ...o, ...row } : o))
          })
        },
      )
      .subscribe()

    const poll = window.setInterval(() => {
      if (mode === 'live') {
        void fetchTracked({ liveOnly: true, showLoading: false })
      } else if (activeQuery) {
        void fetchTracked({ query: activeQuery, liveOnly: false, showLoading: false })
      }
    }, 15_000)

    return () => {
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [open, admin, mode, activeQuery, fetchTracked])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-14 px-5 rounded-full bg-red-500 text-white font-black shadow-lg shadow-red-500/30 flex items-center gap-2 hover:scale-105 transition-transform"
        aria-label="Master track orders"
      >
        <Radio className="h-5 w-5" />
        <span className="hidden sm:inline">Live Track</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            onClick={() => setOpen(false)}
            aria-label="Close tracker"
          />
          <div className="relative w-full max-w-xl rounded-2xl border border-red-500/20 bg-[#0c0c10] shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <div>
                <h2 className="font-display font-bold text-lg">Master Order Tracker</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live delivery status across all users — syncs with the provider
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 w-9 rounded-lg border border-white/10 grid place-items-center hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="flex gap-2 p-1 rounded-xl border border-white/10 bg-white/[0.02]">
                <button
                  type="button"
                  onClick={() => void runLive()}
                  className={`flex-1 h-9 rounded-lg text-sm font-bold ${
                    mode === 'live' ? 'bg-red-500 text-white' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Live queue
                </button>
                <button
                  type="button"
                  onClick={() => setMode('search')}
                  className={`flex-1 h-9 rounded-lg text-sm font-bold ${
                    mode === 'search' ? 'bg-red-500 text-white' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Search
                </button>
              </div>

              {mode === 'search' && (
                <div className="flex gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="0241234567 or ORD-…"
                    className="flex-1 h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none focus:border-red-500/50"
                    onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
                  />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void runSearch()}
                    className="h-11 px-4 rounded-lg bg-red-500 text-white font-bold disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <Search className="h-4 w-4" />
                    {loading ? '…' : 'Track'}
                  </button>
                </div>
              )}

              {(mode === 'live' || orders.length > 0) && !error && (
                <p className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                  <Radio className="h-3 w-3 animate-pulse" />
                  Live updates active · {orders.length} order(s)
                </p>
              )}

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              {retryMessage && (
                <p
                  className={`text-sm rounded-lg px-3 py-2 border ${
                    retryMessage.includes('retried')
                      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                      : 'text-red-400 bg-red-500/10 border-red-500/20'
                  }`}
                >
                  {retryMessage}
                </p>
              )}

              {loading && orders.length === 0 && (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}

              {orders.length > 0 && (
                <ul className="space-y-3">
                  {orders.map((order) => {
                    const tone = deliveryStatusTone(order)
                    const deliveryLabel = deliveryStatusLabel(order)
                    return (
                      <li
                        key={order.id}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-mono text-xs font-bold">{order.reference}</p>
                          <StatusBadge status={order.status} />
                        </div>
                        {(order.user_name || order.user_email || order.topup_code) && (
                          <p className="text-xs text-muted-foreground">
                            {order.user_name ?? order.user_email ?? 'User'}
                            {order.topup_code ? ` · code ${order.topup_code}` : ''}
                            {order.user_id && (
                              <>
                                {' · '}
                                <Link
                                  to={`/admin/users/${order.user_id}`}
                                  className="text-primary hover:underline font-bold"
                                >
                                  Open user
                                </Link>
                              </>
                            )}
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground">Network</p>
                            <p className="font-medium">{formatNetwork(order.network)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Size</p>
                            <p className="font-medium">{order.size_gb} GB</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Amount</p>
                            <p className="font-medium">{formatCurrency(Number(order.amount))}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Phone</p>
                            <p className="font-medium">{order.phone}</p>
                          </div>
                        </div>
                        <div
                          className={`rounded-lg border px-3 py-2 text-xs font-bold ${TONE_CLASSES[tone]}`}
                        >
                          Delivery: {deliveryLabel}
                          {order.provider_name &&
                            order.status !== 'completed' &&
                            order.status !== 'failed' && (
                              <span className="block font-normal text-[10px] mt-0.5 opacity-80">
                                via {order.provider_name}
                              </span>
                            )}
                        </div>
                        {order.provider_error && order.status === 'failed' && (
                          <p className="text-[10px] text-red-400">{order.provider_error}</p>
                        )}
                        {order.status === 'failed' && (
                          <button
                            type="button"
                            disabled={retryingId === order.id}
                            onClick={() => void retryOrder(order.id)}
                            className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border border-primary/30 bg-primary/10 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-50 w-full"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${retryingId === order.id ? 'animate-spin' : ''}`} />
                            Retry order
                          </button>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          Placed {formatDate(order.created_at)}
                          {order.completed_at && ` · Delivered ${formatDate(order.completed_at)}`}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
