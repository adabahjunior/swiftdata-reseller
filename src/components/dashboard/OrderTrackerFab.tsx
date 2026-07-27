import { Radio, Search, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { StatusBadge } from './ui'
import { useAuth } from '../../context/AuthContext'
import { deliveryStatusLabel, deliveryStatusTone } from '../../lib/deliveryStatus'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'
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
}

const TONE_CLASSES = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  danger: 'border-red-500/30 bg-red-500/10 text-red-400',
  muted: 'border-white/10 bg-white/5 text-muted-foreground',
} as const

export function OrderTrackerFab() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [trackedPhone, setTrackedPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orders, setOrders] = useState<TrackedOrder[]>([])

  const fetchTracked = useCallback(
    async (phoneValue: string, showLoading = true) => {
      if (!user) return
      const trimmed = phoneValue.trim()
      if (!/^0[2-5]\d{8}$/.test(trimmed)) return

      if (showLoading) setLoading(true)
      setError(null)

      triggerProviderStatusSync()

      const { data, error: rpcError } = await supabase.rpc('track_orders_by_phone', {
        p_user_id: user.id,
        p_phone: trimmed,
      })

      if (showLoading) setLoading(false)

      if (rpcError || !data?.success) {
        setError(rpcError?.message ?? data?.error ?? 'Could not find orders')
        setOrders([])
        return
      }

      const rows = (data.orders as TrackedOrder[]) ?? []
      setOrders(rows)
      setTrackedPhone(trimmed)
      if (rows.length === 0) {
        setError('No orders found for this phone number.')
      }
    },
    [user],
  )

  const track = async () => {
    const trimmed = phone.trim()
    if (!/^0[2-5]\d{8}$/.test(trimmed)) {
      setError('Enter a valid Ghana phone e.g. 0241234567')
      return
    }
    setOrders([])
    await fetchTracked(trimmed, true)
  }

  useEffect(() => {
    if (!open || !user || !trackedPhone) return

    const channel = supabase
      .channel(`order-tracker-${trackedPhone}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as TrackedOrder | undefined
          if (!row || row.phone !== trackedPhone) return

          if (payload.eventType === 'DELETE') {
            setOrders((prev) => prev.filter((o) => o.id !== row.id))
            return
          }

          setOrders((prev) => {
            const exists = prev.some((o) => o.id === row.id)
            if (!exists) return [row, ...prev]
            return prev.map((o) => (o.id === row.id ? { ...o, ...row } : o))
          })
        },
      )
      .subscribe()

    const poll = window.setInterval(() => {
      triggerProviderStatusSync()
      void fetchTracked(trackedPhone, false)
    }, 15_000)

    return () => {
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [open, user, trackedPhone, fetchTracked])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-14 px-5 rounded-full bg-primary text-primary-foreground font-black shadow-lg shadow-primary/30 flex items-center gap-2 hover:scale-105 transition-transform"
        aria-label="Track order"
      >
        <Search className="h-5 w-5" />
        <span className="hidden sm:inline">Track Order</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            onClick={() => setOpen(false)}
            aria-label="Close tracker"
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0c0c10] shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <div>
                <h2 className="font-display font-bold text-lg">Order Tracker</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live delivery updates from your provider — refreshes automatically
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
              <div className="flex gap-2">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0241234567"
                  className="flex-1 h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none focus:border-primary/50"
                  onKeyDown={(e) => e.key === 'Enter' && void track()}
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void track()}
                  className="h-11 px-4 rounded-lg bg-primary text-primary-foreground font-bold disabled:opacity-50"
                >
                  {loading ? '…' : 'Track'}
                </button>
              </div>

              {orders.length > 0 && (
                <p className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                  <Radio className="h-3 w-3 animate-pulse" />
                  Live updates active
                </p>
              )}

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
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
