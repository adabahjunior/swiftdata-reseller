import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, PageHeader, Panel, StatCard } from '../../components/dashboard/ui'
import { useTransactions } from '../../hooks/useDashboardData'
import { useAgentAnalytics } from '../../hooks/useSupportAnalytics'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'

const DAY_OPTIONS = [7, 30, 90] as const

export default function AnalyticsPage() {
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(30)
  const { analytics, loading, error, refresh } = useAgentAnalytics(days)
  const { transactions, loading: txLoading } = useTransactions(50)

  const o = analytics?.orders
  const t = analytics?.transactions
  const c = analytics?.customers
  const maxDaily = Math.max(1, ...(analytics?.daily.map((d) => Number(d.revenue)) ?? [1]))

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Analytics"
        description="Full view of your wallet, order performance, customers, and money movement."
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`h-10 px-3 text-sm font-bold ${
                    days === d ? 'bg-primary text-primary-foreground' : 'hover:bg-white/5'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-white/10 text-sm font-bold hover:bg-white/5"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        }
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Wallet balance"
          value={formatCurrency(Number(analytics?.wallet_balance ?? 0))}
          accent
        />
        <StatCard
          label={`${days}d revenue`}
          value={formatCurrency(Number(o?.period_revenue ?? 0))}
          sub={`${o?.period_orders ?? 0} orders`}
        />
        <StatCard
          label="Lifetime spent"
          value={formatCurrency(Number(t?.debits ?? 0))}
          sub={`${formatCurrency(Number(t?.credits ?? 0))} topped up`}
        />
        <StatCard
          label="Success rate"
          value={
            o && o.total > 0 ? `${Math.round((o.completed / o.total) * 100)}%` : '—'
          }
          sub={`${o?.completed ?? 0} completed · ${o?.failed ?? 0} failed`}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Orders snapshot" className="lg:col-span-1">
          {loading || !o ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <dl className="space-y-2 text-sm">
              {[
                ['Total orders', o.total],
                ['Completed', o.completed],
                ['Pending / processing', o.pending],
                ['Failed', o.failed],
                ['Completed revenue', formatCurrency(Number(o.revenue))],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-3 border-b border-white/5 pb-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>

        <Panel title="Customers" className="lg:col-span-1">
          {loading || !c ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <dl className="space-y-2 text-sm">
              {[
                ['Unique phones', c.unique_phones],
                ['Returning (2+)', c.returning_phones],
                ['New (1 order)', c.new_phones],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-3 border-b border-white/5 pb-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>

        <Panel title={`${days}d money flow`} className="lg:col-span-1">
          {loading || !t ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <dl className="space-y-2 text-sm">
              {[
                ['Top-ups (period)', formatCurrency(Number(t.period_credits))],
                ['Spend (period)', formatCurrency(Number(t.period_debits))],
                ['Net (period)', formatCurrency(Number(t.period_credits) - Number(t.period_debits))],
                ['All transactions', t.tx_count],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-3 border-b border-white/5 pb-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
      </div>

      <Panel title={`${days}-day revenue`} description="Completed order revenue by day (GMT Accra).">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !analytics?.daily.length ? (
          <EmptyState title="No orders in this period" />
        ) : (
          <div className="space-y-2">
            {analytics.daily.map((d) => {
              const pct = Math.round((Number(d.revenue) / maxDaily) * 100)
              return (
                <div key={d.day} className="grid grid-cols-[5.5rem_1fr_auto] gap-3 items-center text-sm">
                  <span className="text-xs text-muted-foreground font-mono">
                    {String(d.day).slice(0, 10)}
                  </span>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold tabular-nums whitespace-nowrap">
                    {formatCurrency(Number(d.revenue))} · {d.orders} ord
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Networks" description={`Last ${days} days`}>
          {!analytics?.networks.length ? (
            <EmptyState title="No network breakdown yet" />
          ) : (
            <ul className="divide-y divide-white/10">
              {analytics.networks.map((n) => (
                <li key={n.network} className="py-2.5 flex justify-between gap-3 text-sm">
                  <span className="font-medium">{formatNetwork(n.network)}</span>
                  <span className="text-muted-foreground">
                    {n.orders} orders · {formatCurrency(Number(n.revenue))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent transactions" description="Wallet credits and debits">
          {txLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : transactions.length === 0 ? (
            <EmptyState title="No transactions yet" />
          ) : (
            <ul className="divide-y divide-white/10 max-h-80 overflow-y-auto">
              {transactions.map((tx) => (
                <li key={tx.id} className="py-2.5 flex justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{tx.description}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(tx.created_at)}</p>
                  </div>
                  <span
                    className={`font-bold shrink-0 ${
                      tx.type === 'credit' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {tx.type === 'credit' ? '+' : '−'}
                    {formatCurrency(Number(tx.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
