import { Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NumberVerificationSubmitForm } from '../../components/NumberVerificationSubmitForm'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/format'
import {
  checkNumbers,
  submitNumbersForVerification,
  syncVerificationStatuses,
} from '../../lib/numberVerification'
import { supabase } from '../../lib/supabase'
import type { NumberVerification, Profile } from '../../types/database'

type Row = NumberVerification & { profiles?: Pick<Profile, 'full_name' | 'email' | 'phone'> | null }

const STATUSES: NumberVerification['status'][] = [
  'pending',
  'submitted',
  'verified',
  'unverified',
  'failed',
]

const SYNC_MS = 20_000

export default function AdminNumberVerificationsPage() {
  const { session } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const syncingRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('number_verifications')
      .select('*, profiles(full_name, email, phone)')
      .order('updated_at', { ascending: false })
      .limit(500)

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    const { data } = await query
    setRows((data as Row[]) ?? [])
    setLoading(false)
  }, [statusFilter])

  const syncFromDatahub = useCallback(async () => {
    if (!session?.access_token || syncingRef.current) return
    syncingRef.current = true
    try {
      await syncVerificationStatuses(session.access_token)
      await load()
    } catch {
      /* background */
    } finally {
      syncingRef.current = false
    }
  }, [session?.access_token, load])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('admin-number-verifications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'number_verifications' },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  useEffect(() => {
    if (!session?.access_token) return
    void syncFromDatahub()
    const id = window.setInterval(() => void syncFromDatahub(), SYNC_MS)
    return () => window.clearInterval(id)
  }, [session?.access_token, syncFromDatahub])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const agent = `${row.profiles?.full_name ?? ''} ${row.profiles?.email ?? ''} ${row.profiles?.phone ?? ''}`.toLowerCase()
      return row.phone.includes(q) || agent.includes(q) || (row.provider_message ?? '').toLowerCase().includes(q)
    })
  }, [rows, search])

  const counts = useMemo(() => {
    const pending = rows.filter((r) => r.status === 'pending').length
    const submitted = rows.filter((r) => r.status === 'submitted').length
    const verified = rows.filter((r) => r.status === 'verified').length
    return { pending, submitted, verified, total: rows.length }
  }, [rows])

  const handleSubmit = async (phones: string[]) => {
    if (!session?.access_token) {
      setError('Please sign in again')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const data = await submitNumbersForVerification(phones, session.access_token)
      if (!data.success) {
        setError(data.error ?? 'Submission failed')
        return
      }
      setMessage(
        `${data.check.checked ?? phones.length} checked · ${data.verified} verified · ${data.submitted} submitted`,
      )
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleCheckOnly = async (phones: string[]) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const data = await checkNumbers(phones, session?.access_token)
      if (!data.success) {
        setError(data.error ?? 'Status check failed')
        return
      }
      if (session?.access_token) await syncVerificationStatuses(session.access_token, phones)
      setMessage(
        `${data.checked} checked · ${data.sell_any ?? data.verified} verified · ${data.activate_first ?? data.unverified} unverified`,
      )
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const refreshOpen = async () => {
    if (!session?.access_token) return
    setRefreshing(true)
    setError(null)
    try {
      const data = await syncVerificationStatuses(session.access_token)
      if (!data.success) {
        setError(data.error ?? 'Refresh failed')
        return
      }
      setMessage(`Synced ${data.synced ?? 0} · ${data.verified ?? 0} verified`)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  const updateStatus = async (id: string, status: NumberVerification['status']) => {
    setBusyId(id)
    setMessage(null)
    const { data, error: rpcError } = await supabase.rpc('admin_update_number_verification', {
      p_id: id,
      p_status: status,
    })
    setBusyId(null)
    if (rpcError || !data?.success) {
      setMessage(rpcError?.message ?? data?.error ?? 'Update failed')
      return
    }
    setMessage(`Updated to ${status}`)
    await load()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Number Verifications"
        action={
          <button
            type="button"
            onClick={() => void refreshOpen()}
            disabled={refreshing || busy}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-white/10 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        }
      />

      <div className="grid sm:grid-cols-4 gap-3">
        {[
          ['Total', counts.total],
          ['Pending', counts.pending],
          ['Submitted', counts.submitted],
          ['Verified', counts.verified],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-secondary/30 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-xl font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>

      <Panel title="Submit numbers">
        <NumberVerificationSubmitForm
          busy={busy}
          onSubmit={handleSubmit}
          onCheckOnly={handleCheckOnly}
        />
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        {message && <p className="text-sm text-emerald-400 mt-3">{message}</p>}
      </Panel>

      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search phone or agent…"
          className="h-10 min-w-[220px] flex-1 max-w-sm rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
        />
        <p className="text-xs text-muted-foreground">{filtered.length} shown</p>
      </div>

      <Panel title="Agent submissions">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState title="No submissions" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-mono">{row.phone}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-[160px]">{row.profiles?.full_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                        {row.profiles?.email}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[180px]">
                      <p>{row.provider_name ?? '—'}</p>
                      {row.provider_message && (
                        <p className="truncate" title={row.provider_message}>
                          {row.provider_message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {row.requested_at ? formatDate(row.requested_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(row.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={row.status}
                        disabled={busyId === row.id}
                        onChange={(e) =>
                          void updateStatus(row.id, e.target.value as NumberVerification['status'])
                        }
                        className="h-8 rounded-lg border border-white/10 bg-secondary/50 px-2 text-xs outline-none"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
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
