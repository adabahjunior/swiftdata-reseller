import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from './ui'
import { useAuth } from '../../context/AuthContext'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'
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
}

const STATUS_HINT: Record<string, string> = {
  pending: 'Waiting — admin will process or auto-deliver soon',
  processing: 'Being processed by admin',
  completed: 'Delivered successfully',
  failed: 'Order failed — check balance and retry if needed',
}

export function OrderTrackerFab() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orders, setOrders] = useState<TrackedOrder[]>([])

  const track = async () => {
    if (!user) return
    const trimmed = phone.trim()
    if (!/^0[2-5]\d{8}$/.test(trimmed)) {
      setError('Enter a valid Ghana phone e.g. 0241234567')
      return
    }

    setLoading(true)
    setError(null)
    setOrders([])

    const { data, error: rpcError } = await supabase.rpc('track_orders_by_phone', {
      p_user_id: user.id,
      p_phone: trimmed,
    })

    setLoading(false)

    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? data?.error ?? 'Could not find orders')
      return
    }

    setOrders((data.orders as TrackedOrder[]) ?? [])
    if ((data.orders as TrackedOrder[])?.length === 0) {
      setError('No orders found for this phone number.')
    }
  }

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
                  Status is synced from admin — includes auto-deliver updates
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

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              {orders.length > 0 && (
                <ul className="space-y-3">
                  {orders.map((order) => (
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
                      <p className="text-[11px] text-muted-foreground">
                        {STATUS_HINT[order.status] ?? order.status}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Placed {formatDate(order.created_at)}
                        {order.completed_at && ` · Delivered ${formatDate(order.completed_at)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
