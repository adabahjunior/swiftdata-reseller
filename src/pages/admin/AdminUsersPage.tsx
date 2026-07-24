import { Eye, Search, Shield, ShieldOff, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { useAdminUsers } from '../../hooks/useAdminData'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate } from '../../lib/format'

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth()
  const { users, loading, refresh } = useAdminUsers()
  const [search, setSearch] = useState('')
  const [topupCode, setTopupCode] = useState('')
  const [walletAmount, setWalletAmount] = useState('')
  const [walletMessage, setWalletMessage] = useState<string | null>(null)
  const [walletBusy, setWalletBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.phone?.includes(q) ||
        u.topup_code?.includes(q),
    )
  }, [users, search])

  const adjustByCode = async (mode: 'credit' | 'debit') => {
    if (!currentUser || !topupCode.trim() || !walletAmount) return
    const amount = Number(walletAmount)
    if (amount <= 0) return

    setWalletBusy(true)
    setWalletMessage(null)

    const rpc = mode === 'credit' ? 'admin_credit_wallet' : 'admin_debit_wallet'
    const note =
      mode === 'credit'
        ? `Manual MoMo top-up (ref: ${topupCode.trim()})`
        : `Wallet deducted by admin (ref: ${topupCode.trim()})`

    const { data, error } = await supabase.rpc(rpc, {
      p_admin_id: currentUser.id,
      p_amount: amount,
      p_topup_code: topupCode.trim(),
      p_note: note,
    })

    setWalletBusy(false)
    if (error || !data?.success) {
      setWalletMessage(error?.message ?? data?.error ?? `${mode === 'credit' ? 'Credit' : 'Deduct'} failed`)
      return
    }
    const verb = mode === 'credit' ? 'Credited' : 'Deducted'
    setWalletMessage(
      `${verb} ${formatCurrency(amount)} ${mode === 'credit' ? 'to' : 'from'} user ${data.topup_code}. New balance: ${formatCurrency(Number(data.new_balance))}`,
    )
    setTopupCode('')
    setWalletAmount('')
    await refresh()
  }

  const toggleAdmin = async (userId: string, isAdmin: boolean) => {
    if (userId === currentUser?.id && isAdmin) {
      alert('You cannot remove your own admin privileges.')
      return
    }
    await supabase.from('profiles').update({ is_admin: !isAdmin }).eq('id', userId)
    await refresh()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Users"
        description="Manage users, credit or deduct wallets by top-up code, and view full user dashboards."
      />

      <Panel title="Adjust Wallet by Top-Up Code" description="Credit after MoMo top-up, or deduct balance when needed.">
        <div className="grid sm:grid-cols-4 gap-3 items-end max-w-3xl">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Top-Up Code</label>
            <input
              value={topupCode}
              onChange={(e) => setTopupCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="12345"
              maxLength={5}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm font-mono tracking-widest outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Amount (GHS)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={walletAmount}
              onChange={(e) => setWalletAmount(e.target.value)}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void adjustByCode('credit')}
            disabled={walletBusy || topupCode.length !== 5}
            className="h-10 rounded-lg bg-emerald-500 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Wallet className="h-4 w-4" />
            {walletBusy ? 'Working…' : 'Credit'}
          </button>
          <button
            type="button"
            onClick={() => void adjustByCode('debit')}
            disabled={walletBusy || topupCode.length !== 5}
            className="h-10 rounded-lg bg-red-500 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Wallet className="h-4 w-4" />
            {walletBusy ? 'Working…' : 'Deduct'}
          </button>
        </div>
        {walletMessage && (
          <p className={`text-sm mt-3 ${walletMessage.startsWith('Credited') || walletMessage.startsWith('Deducted') ? 'text-emerald-400' : 'text-destructive'}`}>
            {walletMessage}
          </p>
        )}
      </Panel>

      <Panel title="All Users" description={`${filtered.length} user(s)`}>
        <div className="mb-4 relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, or code…"
            className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 pl-9 pr-3 text-sm outline-none"
          />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading users…</p>
        ) : filtered.length === 0 ? (
          <EmptyState title="No users found" description="Try a different search." />
        ) : (
          <div className="overflow-x-auto -mx-5 md:-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="px-5 md:px-6 py-3 font-medium">Name</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Code</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Balance</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Status</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Joined</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filtered.map((profile) => (
                  <tr key={profile.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 md:px-6 py-3">
                      <p className="font-medium">{profile.full_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{profile.email}</p>
                    </td>
                    <td className="px-5 md:px-6 py-3 font-mono font-bold text-primary tracking-widest">
                      {profile.topup_code}
                    </td>
                    <td className="px-5 md:px-6 py-3 font-bold">
                      {formatCurrency(Number(profile.wallet_balance))}
                    </td>
                    <td className="px-5 md:px-6 py-3">
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={profile.is_active ? 'active' : 'inactive'} />
                        {!profile.api_enabled && (
                          <span className="text-[10px] text-amber-400 font-bold">API OFF</span>
                        )}
                        {profile.is_admin && (
                          <span className="text-[10px] text-red-400 font-bold">ADMIN</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 md:px-6 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {formatDate(profile.created_at)}
                    </td>
                    <td className="px-5 md:px-6 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/admin/users/${profile.id}`}
                          className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </Link>
                        <button
                          type="button"
                          onClick={() => toggleAdmin(profile.id, profile.is_admin)}
                          disabled={profile.id === currentUser?.id && profile.is_admin}
                          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                          title={profile.is_admin ? 'Revoke admin' : 'Grant admin'}
                        >
                          {profile.is_admin ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                        </button>
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
