import { Copy } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, PageHeader, Panel, StatCard } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { MANUAL_TOPUP } from '../../lib/constants'
import { useTransactions } from '../../hooks/useDashboardData'
import { formatCurrency, formatDate } from '../../lib/format'

export default function ApiBalancePage() {
  const { user } = useAuth()
  const { transactions, loading } = useTransactions()
  const [copied, setCopied] = useState(false)

  const totalCredits = transactions
    .filter((t) => t.type === 'credit')
    .reduce((sum, t) => sum + Number(t.amount), 0)
  const totalDebits = transactions
    .filter((t) => t.type === 'debit')
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const copyCode = async () => {
    if (!user?.topup_code) return
    await navigator.clipboard.writeText(user.topup_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="My API Balance"
        description="Top-ups are processed manually by admin after MoMo payment. API purchases deduct from this balance."
      />

      <div className="grid sm:grid-cols-3 gap-3 md:gap-4">
        <StatCard label="Available Balance" value={formatCurrency(user?.wallet_balance ?? 0)} accent />
        <StatCard label="Total Top-ups" value={formatCurrency(totalCredits)} />
        <StatCard label="Total Spent" value={formatCurrency(totalDebits)} />
      </div>

      <Panel title="Manual Top-Up Instructions" description="Send MoMo and use your unique code as reference — it is mandatory.">
        <div className="space-y-4">
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
            <p className="text-xs font-bold uppercase text-primary mb-3 tracking-wider">Your Top-Up Code</p>
            <div className="flex items-center gap-3">
              <span className="font-black text-4xl tracking-[0.3em] text-primary font-mono">
                {user?.topup_code ?? '-----'}
              </span>
              <button
                type="button"
                onClick={copyCode}
                className="h-10 w-10 rounded-lg border border-white/10 grid place-items-center hover:bg-white/5"
                aria-label="Copy code"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {copied && <p className="text-xs text-emerald-400 mt-2">Code copied!</p>}
            <p className="text-sm text-muted-foreground mt-3">
              You <strong className="text-foreground">must</strong> use this code as the MoMo reference when paying.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            {[
              { label: 'MoMo Number', value: MANUAL_TOPUP.phone },
              { label: 'Network', value: MANUAL_TOPUP.network },
              { label: 'Account Name', value: MANUAL_TOPUP.name },
              { label: 'Reference', value: user?.topup_code ?? '—', highlight: true },
            ].map((item) => (
              <div
                key={item.label}
                className={`rounded-xl border p-4 ${item.highlight ? 'border-primary/30 bg-primary/5' : 'border-white/10 bg-white/[0.02]'}`}
              >
                <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                <p className={`font-bold ${item.highlight ? 'text-primary font-mono text-lg tracking-widest' : ''}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Send your desired amount to the MoMo number above</li>
            <li>Use your top-up code <strong className="text-primary font-mono">{user?.topup_code}</strong> as reference</li>
            <li>Admin will credit your wallet — it will appear below once confirmed</li>
            <li>Use the API to buy data — cost is deducted from your balance automatically</li>
          </ol>
        </div>
      </Panel>

      <Panel title="Transaction History">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading transactions…</p>
        ) : transactions.length === 0 ? (
          <EmptyState
            title="No transactions yet"
            description="Manual top-ups and API purchases will appear here."
          />
        ) : (
          <div className="overflow-x-auto -mx-5 md:-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="px-5 md:px-6 py-3 font-medium">Date</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Description</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Reference</th>
                  <th className="px-5 md:px-6 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="px-5 md:px-6 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(tx.created_at)}
                    </td>
                    <td className="px-5 md:px-6 py-3">{tx.description}</td>
                    <td className="px-5 md:px-6 py-3 font-mono text-xs text-muted-foreground">
                      {tx.reference ?? '—'}
                    </td>
                    <td
                      className={`px-5 md:px-6 py-3 text-right font-bold whitespace-nowrap ${
                        tx.type === 'credit' ? 'text-emerald-400' : 'text-destructive'
                      }`}
                    >
                      {tx.type === 'credit' ? '+' : '-'}
                      {formatCurrency(Number(tx.amount))}
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
