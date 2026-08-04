import { RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader, Panel, StatCard, StatusBadge } from '../dashboard/ui'
import { formatCurrency, formatDate } from '../../lib/format'
import {
  useSkplugRefunds,
  type SkplugRefundOrder,
} from '../../lib/skplugRefunds'

const BUCKETS = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'refund_requested', label: 'Refund requested' },
  { key: 'refunded', label: 'Refunded' },
] as const

type BucketKey = (typeof BUCKETS)[number]['key']

function bucketLabel(status: string) {
  return status.replace(/_/g, ' ')
}

function OrderRows({
  orders,
  isAdmin,
}: {
  orders: SkplugRefundOrder[]
  isAdmin: boolean
}) {
  if (orders.length === 0) {
    return (
      <EmptyState
        title="No orders in this list"
        description={
          isAdmin
            ? 'SK Plug has no orders in this bucket right now.'
            : 'None of your matched SK Plug orders are in this bucket.'
        }
      />
    )
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b border-white/10">
            <th className="pb-3 pr-3 font-medium">SK order</th>
            <th className="pb-3 pr-3 font-medium">Recipient</th>
            <th className="pb-3 pr-3 font-medium">Network</th>
            <th className="pb-3 pr-3 font-medium">GB</th>
            <th className="pb-3 pr-3 font-medium">Paid</th>
            <th className="pb-3 pr-3 font-medium">Owed</th>
            <th className="pb-3 pr-3 font-medium">Status</th>
            {isAdmin && <th className="pb-3 pr-3 font-medium">User</th>}
            <th className="pb-3 font-medium">Local order</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={`${order.bucket}-${order.order_id}`} className="border-b border-white/5">
              <td className="py-3 pr-3">
                <p className="font-mono text-xs">{order.order_id || '—'}</p>
                {order.created_at && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {formatDate(order.created_at)}
                  </p>
                )}
              </td>
              <td className="py-3 pr-3 font-medium">{order.recipient || '—'}</td>
              <td className="py-3 pr-3">{order.network || '—'}</td>
              <td className="py-3 pr-3">{order.gb_size || '—'}</td>
              <td className="py-3 pr-3">{formatCurrency(order.price_paid || 0)}</td>
              <td className="py-3 pr-3 font-semibold text-primary">
                {formatCurrency(order.amount_owed || 0)}
              </td>
              <td className="py-3 pr-3">
                <div className="flex flex-col gap-1 items-start">
                  <StatusBadge status={order.bucket || order.status} />
                  {order.paid === true && (
                    <span className="text-[10px] text-emerald-400 font-semibold uppercase">
                      Paid
                    </span>
                  )}
                  {order.paid === false && order.bucket === 'refund_requested' && (
                    <span className="text-[10px] text-amber-400 font-semibold uppercase">
                      Unpaid
                    </span>
                  )}
                </div>
              </td>
              {isAdmin && (
                <td className="py-3 pr-3">
                  {order.local_order?.user ? (
                    <div>
                      <p className="font-medium">
                        {order.local_order.user.full_name || 'User'}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {order.local_order.user.email}
                      </p>
                      <Link
                        to={`/admin/users/${order.local_order.user_id}`}
                        className="text-[11px] text-primary hover:underline"
                      >
                        View user
                      </Link>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Unmatched</span>
                  )}
                </td>
              )}
              <td className="py-3">
                {order.local_order ? (
                  <div>
                    <p className="font-mono text-xs">{order.local_order.reference}</p>
                    <StatusBadge status={order.local_order.status} />
                    {order.local_order.provider_error && (
                      <p className="text-[11px] text-red-400 mt-1 max-w-[220px]">
                        {order.local_order.provider_error}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {isAdmin ? 'No local match' : '—'}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SkplugRefundsView({
  isAdmin = false,
}: {
  isAdmin?: boolean
}) {
  const { data, loading, error, refresh } = useSkplugRefunds()
  const [tab, setTab] = useState<BucketKey | 'all'>('all')
  const [search, setSearch] = useState('')

  const allOrders = useMemo(
    () => [
      ...data.waiting.orders,
      ...data.refund_requested.orders,
      ...data.refunded.orders,
    ],
    [data],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const source =
      tab === 'all'
        ? allOrders
        : tab === 'waiting'
          ? data.waiting.orders
          : tab === 'refund_requested'
            ? data.refund_requested.orders
            : data.refunded.orders

    if (!q) return source
    return source.filter((o) => {
      const hay = [
        o.order_id,
        o.recipient,
        o.network,
        o.local_order?.reference,
        o.local_order?.user?.email,
        o.local_order?.user?.full_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [allOrders, data, search, tab])

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title={isAdmin ? 'SK Plug Refunds' : 'My Refunds'}
        description={
          isAdmin
            ? 'Rejected and refunded SK Data Plug orders across all users. Unmatched provider rows stay admin-only.'
            : 'Your SK Data Plug orders that are waiting, refund-requested, or refunded.'
        }
        action={
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm hover:bg-secondary disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {error && (
        <p className="text-sm rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 px-4 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Total owed"
          value={formatCurrency(data.totals.amount_owed)}
          sub={`${data.totals.count} order(s)`}
          accent
        />
        <StatCard
          label="Waiting"
          value={String(data.waiting.count)}
          sub={formatCurrency(data.waiting.total)}
        />
        <StatCard
          label="Refund requested"
          value={String(data.refund_requested.count)}
          sub={formatCurrency(data.refund_requested.total)}
        />
        <StatCard
          label="Refunded"
          value={String(data.refunded.count)}
          sub={formatCurrency(data.refunded.total)}
        />
      </div>

      <Panel
        title="Orders"
        description={
          data.fetched_at
            ? `From ${data.provider ?? 'SK Plug'} · updated ${formatDate(data.fetched_at)}`
            : 'Live from SK Data Plug orders-summary'
        }
      >
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAdmin ? 'Search phone, order, user…' : 'Search phone or order…'}
              className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 pl-9 pr-3 text-sm outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab('all')}
              className={`h-10 rounded-lg border px-3 text-sm ${
                tab === 'all'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-white/10 bg-secondary/50'
              }`}
            >
              All ({data.totals.count})
            </button>
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setTab(b.key)}
                className={`h-10 rounded-lg border px-3 text-sm capitalize ${
                  tab === b.key
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-white/10 bg-secondary/50'
                }`}
              >
                {bucketLabel(b.key)} ({data[b.key].count})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading refunds from SK Plug…</p>
        ) : (
          <OrderRows orders={filtered} isAdmin={isAdmin} />
        )}
      </Panel>
    </div>
  )
}
