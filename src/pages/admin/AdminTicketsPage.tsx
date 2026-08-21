import { CheckCircle2, Loader2, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { useTicketMessages } from '../../hooks/useSupportAnalytics'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Profile, SupportTicket } from '../../types/database'

type TicketRow = SupportTicket & {
  profiles?: Pick<Profile, 'full_name' | 'email'> | null
}

const STATUSES: SupportTicket['status'][] = ['open', 'in_progress', 'resolved', 'closed']

export default function AdminTicketsPage() {
  const { user: admin } = useAuth()
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | SupportTicket['status']>('open')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [reply, setReply] = useState('')
  const [status, setStatus] = useState<SupportTicket['status']>('in_progress')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    let query = supabase
      .from('support_tickets')
      .select('*, profiles(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(300)

    if (filter !== 'all') query = query.eq('status', filter)

    const { data } = await query
    setTickets((data as TicketRow[]) ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => {
    void refresh()
    const channel = supabase
      .channel('admin-support-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => {
        void refresh()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  const selected = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId],
  )
  const { messages, loading: msgsLoading, refresh: refreshMsgs } = useTicketMessages(selectedId)

  useEffect(() => {
    if (!selected) return
    setFeedback(selected.admin_feedback ?? '')
    setStatus(selected.status === 'open' ? 'in_progress' : selected.status)
  }, [selected])

  const save = async (markResolved = false) => {
    if (!admin || !selectedId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    const nextStatus = markResolved ? 'resolved' : status
    const { data, error: rpcError } = await supabase.rpc('admin_update_ticket', {
      p_admin_id: admin.id,
      p_ticket_id: selectedId,
      p_status: nextStatus,
      p_feedback: feedback,
      p_reply: reply.trim() || null,
    })
    setBusy(false)
    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? data?.error ?? 'Update failed')
      return
    }
    setReply('')
    setMessage(markResolved ? 'Marked resolved and feedback saved.' : 'Ticket updated.')
    await refresh()
    await refreshMsgs()
  }

  const openCount = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Support Tickets"
        description="Review user-reported issues, send feedback, and mark fixed."
      />

      <div className="flex flex-wrap gap-2">
        {(['open', 'in_progress', 'resolved', 'closed', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`h-9 px-3 rounded-lg border text-sm capitalize ${
              filter === f
                ? 'border-primary/40 bg-primary/10 text-primary font-bold'
                : 'border-white/10 hover:bg-white/5'
            }`}
          >
            {f === 'open' ? `Open queue` : f.replace('_', ' ')}
            {f === 'open' && filter === 'open' ? ` (${openCount})` : ''}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <Panel title="Tickets" className="lg:col-span-2" description={`${tickets.length} shown`}>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tickets.length === 0 ? (
            <EmptyState title="No tickets" description="Nothing in this filter." />
          ) : (
            <ul className="divide-y divide-white/10 max-h-[32rem] overflow-y-auto">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left py-3 px-1 ${
                      selectedId === t.id ? 'bg-primary/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-medium truncate text-sm">{t.subject}</p>
                      <StatusBadge status={t.status} />
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {t.profiles?.full_name || t.profiles?.email || 'User'} · {formatDate(t.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={selected ? selected.subject : 'Ticket'}
          className="lg:col-span-3"
          description={
            selected
              ? `${selected.profiles?.full_name ?? 'User'} · ${selected.profiles?.email ?? ''}`
              : 'Select a ticket'
          }
        >
          {!selected ? (
            <EmptyState title="Select a ticket" />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={selected.status} />
                <StatusBadge status={selected.priority} />
                {selected.order_reference && (
                  <span className="text-xs font-mono border border-white/10 rounded-full px-2.5 py-0.5">
                    {selected.order_reference}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm whitespace-pre-wrap">
                {selected.body}
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Conversation
                </p>
                {msgsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages yet.</p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-xl border p-3 text-sm ${
                        m.is_admin_reply
                          ? 'border-primary/30 bg-primary/5'
                          : 'border-white/10 bg-white/[0.03]'
                      }`}
                    >
                      <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">
                        {m.is_admin_reply ? 'Admin' : 'User'} · {formatDate(m.created_at)}
                      </p>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SupportTicket['status'])}
                    className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Feedback to user</label>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={3}
                  placeholder="Tell the user what was done / how to proceed…"
                  className="w-full rounded-lg border border-white/10 bg-secondary/50 px-3 py-2 text-sm outline-none resize-y"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Reply message</label>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Optional chat reply…"
                  className="w-full rounded-lg border border-white/10 bg-secondary/50 px-3 py-2 text-sm outline-none resize-y"
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}
              {message && <p className="text-sm text-emerald-400">{message}</p>}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(false)}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-white/10 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Save & send
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(true)}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark fixed
                </button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
