import { ArrowLeft, Key, RefreshCw, Shield, ShieldOff, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState, PageHeader, Panel, StatCard, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { useAdminUserDetail } from '../../hooks/useAdminData'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, formatNetwork, generateApiKey } from '../../lib/format'
import type { ApiKey, Profile } from '../../types/database'

export default function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const { user: admin } = useAuth()
  const { profile, orders, transactions, keys, loading, refresh } = useAdminUserDetail(userId)

  const [creditAmount, setCreditAmount] = useState('')
  const [creditNote, setCreditNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const creditWallet = async () => {
    if (!admin || !userId) return
    const amount = Number(creditAmount)
    if (!amount || amount <= 0) {
      setMessage('Enter a valid amount')
      return
    }
    setSubmitting(true)
    setMessage(null)

    const { data, error } = await supabase.rpc('admin_credit_wallet', {
      p_admin_id: admin.id,
      p_amount: amount,
      p_user_id: userId,
      p_note: creditNote.trim() || `Manual top-up credited by admin`,
    })

    setSubmitting(false)
    if (error || !data?.success) {
      setMessage(error?.message ?? data?.error ?? 'Credit failed')
      return
    }
    setCreditAmount('')
    setCreditNote('')
    setMessage(`Credited ${formatCurrency(amount)}. New balance: ${formatCurrency(Number(data.new_balance))}`)
    await refresh()
  }

  const toggleAccount = async (p: Profile) => {
    await supabase.from('profiles').update({ is_active: !p.is_active }).eq('id', p.id)
    await refresh()
  }

  const toggleApi = async (p: Profile) => {
    await supabase.from('profiles').update({ api_enabled: !p.api_enabled }).eq('id', p.id)
    await refresh()
  }

  const revokeKey = async (keyId: string) => {
    await supabase.from('api_keys').update({ is_active: false }).eq('id', keyId)
    await refresh()
  }

  const regenerateKey = async (key: ApiKey) => {
    const newValue = generateApiKey()
    await supabase
      .from('api_keys')
      .update({ key_value: newValue, key_prefix: newValue.slice(0, 16), is_active: true })
      .eq('id', key.id)
    setMessage(`New key for "${key.name}": ${newValue} — copy it now, it won't be shown again.`)
    await refresh()
  }

  const createKey = async () => {
    if (!userId) return
    const newValue = generateApiKey()
    await supabase.from('api_keys').insert({
      user_id: userId,
      name: 'Admin Generated Key',
      key_value: newValue,
      key_prefix: newValue.slice(0, 16),
    })
    setMessage(`New API key: ${newValue}`)
    await refresh()
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading user…</p>
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <Link to="/admin/users" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to users
        </Link>
        <EmptyState title="User not found" description="This user may have been deleted." />
      </div>
    )
  }

  const totalSpent = orders
    .filter((o) => o.status === 'completed')
    .reduce((s, o) => s + Number(o.amount), 0)

  return (
    <div className="space-y-6 md:space-y-8">
      <div>
        <Link to="/admin/users" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to users
        </Link>
        <PageHeader
          title={profile.full_name ?? profile.email ?? 'User'}
          description={`Top-up code: ${profile.topup_code} · ${profile.email}`}
        />
      </div>

      {message && (
        <p className={`text-sm rounded-lg px-4 py-3 border ${message.includes('Credited') || message.includes('New key') || message.includes('New API') ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' : 'text-destructive border-destructive/30 bg-destructive/5'}`}>
          {message}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Balance" value={formatCurrency(Number(profile.wallet_balance))} accent />
        <StatCard label="Orders" value={String(orders.length)} />
        <StatCard label="Total Spent" value={formatCurrency(totalSpent)} />
        <StatCard label="API Keys" value={String(keys.filter((k) => k.is_active).length)} sub="active" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Credit Wallet" description="Search by code on Users page, or credit directly here.">
          <div className="space-y-3">
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <p className="text-xs text-muted-foreground">Top-up code</p>
              <p className="font-mono font-black text-2xl text-primary tracking-widest">{profile.topup_code}</p>
            </div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Amount (GHS)"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
            <input
              placeholder="Note (optional)"
              value={creditNote}
              onChange={(e) => setCreditNote(e.target.value)}
              className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
            <button
              type="button"
              onClick={creditWallet}
              disabled={submitting}
              className="w-full h-10 rounded-lg bg-red-500 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Wallet className="h-4 w-4" />
              {submitting ? 'Crediting…' : 'Credit Wallet'}
            </button>
          </div>
        </Panel>

        <Panel title="Account Controls">
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3">
              <div>
                <p className="font-medium">Account Status</p>
                <StatusBadge status={profile.is_active ? 'active' : 'inactive'} />
              </div>
              <button
                type="button"
                onClick={() => toggleAccount(profile)}
                className="text-xs font-bold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                {profile.is_active ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                {profile.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3">
              <div>
                <p className="font-medium">API Access</p>
                <StatusBadge status={profile.api_enabled ? 'active' : 'inactive'} />
              </div>
              <button
                type="button"
                onClick={() => toggleApi(profile)}
                className="text-xs font-bold text-muted-foreground hover:text-foreground"
              >
                {profile.api_enabled ? 'Disable API' : 'Enable API'}
              </button>
            </div>
            {profile.is_admin && (
              <p className="text-xs text-red-400 font-bold">This user is an admin</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="API Keys"
        description={`${keys.length} key(s)`}
        action={
          <button
            type="button"
            onClick={createKey}
            className="text-xs font-bold text-primary hover:underline"
          >
            + Generate Key
          </button>
        }
      >
        {keys.length === 0 ? (
          <EmptyState title="No API keys" description="Generate a key for this user." />
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3 gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-primary shrink-0" />
                    <span className="font-medium">{key.name}</span>
                    <StatusBadge status={key.is_active ? 'active' : 'inactive'} />
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-1">{key.key_prefix}••••••••</p>
                  <p className="text-xs text-muted-foreground">{key.requests_count} requests</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => regenerateKey(key)}
                    className="text-xs font-bold text-primary inline-flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3" /> Regenerate
                  </button>
                  {key.is_active && (
                    <button type="button" onClick={() => revokeKey(key.id)} className="text-xs font-bold text-destructive">
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recent Orders" description={`${orders.length} total`}>
        {orders.length === 0 ? (
          <EmptyState title="No orders" description="API orders will appear here." />
        ) : (
          <div className="overflow-x-auto -mx-5 md:-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="px-5 py-3 font-medium">Reference</th>
                  <th className="px-5 py-3 font-medium">Network</th>
                  <th className="px-5 py-3 font-medium">Size</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {orders.slice(0, 10).map((o) => (
                  <tr key={o.id}>
                    <td className="px-5 py-3 font-mono text-xs">{o.reference}</td>
                    <td className="px-5 py-3">{formatNetwork(o.network)}</td>
                    <td className="px-5 py-3">{o.size_gb} GB</td>
                    <td className="px-5 py-3 font-bold">{formatCurrency(Number(o.amount))}</td>
                    <td className="px-5 py-3"><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Transactions">
        {transactions.length === 0 ? (
          <EmptyState title="No transactions" description="Credits and debits appear here." />
        ) : (
          <ul className="divide-y divide-white/10">
            {transactions.slice(0, 15).map((tx) => (
              <li key={tx.id} className="py-3 flex justify-between gap-4 text-sm">
                <div>
                  <p>{tx.description}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(tx.created_at)}</p>
                </div>
                <span className={`font-bold shrink-0 ${tx.type === 'credit' ? 'text-emerald-400' : 'text-destructive'}`}>
                  {tx.type === 'credit' ? '+' : '-'}{formatCurrency(Number(tx.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
