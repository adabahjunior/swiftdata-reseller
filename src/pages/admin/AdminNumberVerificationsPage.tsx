import { useEffect, useMemo, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { NumberVerification, Profile } from '../../types/database'

type Row = NumberVerification & { profiles?: Pick<Profile, 'full_name' | 'email'> | null }

const STATUSES: NumberVerification['status'][] = [
  'pending',
  'submitted',
  'verified',
  'unverified',
  'failed',
]

export default function AdminNumberVerificationsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    let query = supabase
      .from('number_verifications')
      .select('*, profiles(full_name, email)')
      .order('requested_at', { ascending: false, nullsFirst: false })
      .limit(200)

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    const { data } = await query
    setRows((data as Row[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [statusFilter])

  const counts = useMemo(() => {
    const pending = rows.filter((r) => r.status === 'pending').length
    return { pending }
  }, [rows])

  const updateStatus = async (id: string, status: NumberVerification['status']) => {
    setBusyId(id)
    setMessage(null)
    const { data, error } = await supabase.rpc('admin_update_number_verification', {
      p_id: id,
      p_status: status,
    })
    setBusyId(null)
    if (error || !data?.success) {
      setMessage(error?.message ?? data?.error ?? 'Update failed')
      return
    }
    setMessage(`Updated to ${status}`)
    await load()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Number Verifications"
        description="Users request MTN beneficiary verification after a failed Datahub check. Mark numbers as submitted or verified here."
      />

      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
        >
          <option value="all">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {statusFilter === 'pending' && (
          <p className="text-xs text-muted-foreground">{counts.pending} pending in this view</p>
        )}
        {message && <p className="text-sm text-emerald-400">{message}</p>}
      </div>

      <Panel title="Verification queue">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No requests" description="No number verification requests match this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Requested</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-mono">{row.phone}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-[140px]">{row.profiles?.full_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[140px]">
                        {row.profiles?.email}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px]">
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
