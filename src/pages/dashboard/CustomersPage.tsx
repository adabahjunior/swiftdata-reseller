import { RefreshCw, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatCard } from '../../components/dashboard/ui'
import { useAgentCustomers } from '../../hooks/useSupportAnalytics'
import { formatCurrency, formatDate, formatNetwork } from '../../lib/format'

export default function CustomersPage() {
  const { customers, returningCount, totalCount, loading, error, refresh } = useAgentCustomers()
  const [query, setQuery] = useState('')
  const [returningOnly, setReturningOnly] = useState(true)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return customers.filter((c) => {
      if (returningOnly && !c.is_returning) return false
      if (!q) return true
      return c.phone.includes(q) || (c.top_network ?? '').toLowerCase().includes(q)
    })
  }, [customers, query, returningOnly])

  const totalSpent = customers
    .filter((c) => (returningOnly ? c.is_returning : true))
    .reduce((sum, c) => sum + Number(c.total_spent), 0)

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Returning Customers"
        description="Beneficiary numbers that have ordered through you more than once."
        action={
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-white/10 text-sm font-bold hover:bg-white/5"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="All customers" value={String(totalCount)} />
        <StatCard label="Returning" value={String(returningCount)} accent />
        <StatCard label="New (1 order)" value={String(Math.max(totalCount - returningCount, 0))} />
        <StatCard label="Spent (shown)" value={formatCurrency(totalSpent)} />
      </div>

      <Panel title="Customer list" description="Based on phone numbers on your orders.">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search phone or network…"
            className="flex-1 h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
          />
          <label className="inline-flex items-center gap-2 text-sm font-medium shrink-0">
            <input
              type="checkbox"
              checked={returningOnly}
              onChange={(e) => setReturningOnly(e.target.checked)}
              className="rounded border-white/20"
            />
            Returning only (2+ orders)
          </label>
        </div>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading customers…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={returningOnly ? 'No returning customers yet' : 'No customers yet'}
            description="Customers appear here from successful and pending orders placed to beneficiary phones."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="py-2 pr-3 font-medium">Phone</th>
                  <th className="py-2 pr-3 font-medium">Orders</th>
                  <th className="py-2 pr-3 font-medium">Spent</th>
                  <th className="py-2 pr-3 font-medium">Network</th>
                  <th className="py-2 pr-3 font-medium">First</th>
                  <th className="py-2 font-medium">Last</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filtered.map((c) => (
                  <tr key={c.phone}>
                    <td className="py-2.5 pr-3 font-mono">
                      <span className="inline-flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-primary" />
                        {c.phone}
                        {c.is_returning && (
                          <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                            Returning
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-bold">{c.order_count}</td>
                    <td className="py-2.5 pr-3">{formatCurrency(Number(c.total_spent))}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {c.top_network ? formatNetwork(c.top_network) : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {formatDate(c.first_order_at)}
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">{formatDate(c.last_order_at)}</td>
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
