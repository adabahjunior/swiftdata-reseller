import { Loader2, MessageSquarePlus, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { useSupportTickets, useTicketMessages } from '../../hooks/useSupportAnalytics'
import { formatDate } from '../../lib/format'
import type { SupportTicket } from '../../types/database'

const PRIORITIES: SupportTicket['priority'][] = ['low', 'normal', 'high']

export default function TicketsPage() {
  const { user } = useAuth()
  const { tickets, loading, createTicket, addMessage, refresh } = useSupportTickets()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [orderRef, setOrderRef] = useState('')
  const [priority, setPriority] = useState<SupportTicket['priority']>('normal')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const selected = useMemo(
    () => tickets.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId],
  )
  const { messages, loading: msgsLoading } = useTicketMessages(selectedId)

  const submitTicket = async () => {
    if (!subject.trim() || !body.trim()) {
      setError('Subject and description are required')
      return
    }
    setBusy(true)
    setError(null)
    const res = await createTicket({
      subject,
      body,
      order_reference: orderRef,
      priority,
    })
    setBusy(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    setSubject('')
    setBody('')
    setOrderRef('')
    setPriority('normal')
    setShowForm(false)
    setSelectedId(res.ticket.id)
  }

  const sendReply = async () => {
    if (!selectedId || !reply.trim()) return
    setBusy(true)
    setError(null)
    const res = await addMessage(selectedId, reply)
    setBusy(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    setReply('')
    await refresh()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Support Tickets"
        description="Report issues to admin. You’ll get feedback here when they’re reviewed."
        action={
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold"
          >
            <MessageSquarePlus className="h-4 w-4" />
            {showForm ? 'Close form' : 'New ticket'}
          </button>
        }
      />

      {showForm && (
        <Panel title="Open a ticket">
          <div className="space-y-3">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Describe the issue…"
              className="w-full rounded-lg border border-white/10 bg-secondary/50 px-3 py-2 text-sm outline-none resize-y"
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                value={orderRef}
                onChange={(e) => setOrderRef(e.target.value)}
                placeholder="Order reference (optional)"
                className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm font-mono outline-none"
              />
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as SupportTicket['priority'])}
                className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    Priority: {p}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitTicket()}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit ticket
            </button>
          </div>
        </Panel>
      )}

      <div className="grid lg:grid-cols-5 gap-4">
        <Panel title="Your tickets" className="lg:col-span-2" description={`${tickets.length} total`}>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tickets.length === 0 ? (
            <EmptyState title="No tickets yet" description="Open a ticket to report an issue to admin." />
          ) : (
            <ul className="divide-y divide-white/10 max-h-[28rem] overflow-y-auto">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left py-3 px-1 transition-colors ${
                      selectedId === t.id ? 'bg-primary/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-medium truncate text-sm">{t.subject}</p>
                      <StatusBadge status={t.status} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">{formatDate(t.created_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={selected ? selected.subject : 'Ticket details'}
          className="lg:col-span-3"
          description={selected ? `Opened ${formatDate(selected.created_at)}` : 'Select a ticket'}
        >
          {!selected ? (
            <EmptyState title="Select a ticket" description="Pick one from the list to view messages and feedback." />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={selected.status} />
                <StatusBadge status={selected.priority} />
                {selected.order_reference && (
                  <span className="text-xs font-mono text-muted-foreground border border-white/10 rounded-full px-2.5 py-0.5">
                    {selected.order_reference}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm whitespace-pre-wrap">
                {selected.body}
              </div>

              {selected.admin_feedback && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">
                    Admin feedback
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{selected.admin_feedback}</p>
                </div>
              )}

              <div className="space-y-2 max-h-56 overflow-y-auto">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Conversation</p>
                {msgsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No replies yet.</p>
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
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                        {m.is_admin_reply ? 'Admin' : user?.full_name ?? 'You'} · {formatDate(m.created_at)}
                      </p>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))
                )}
              </div>

              {selected.status !== 'closed' && (
                <div className="flex gap-2">
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Add a follow-up…"
                    className="flex-1 h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || !reply.trim()}
                    onClick={() => void sendReply()}
                    className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60"
                  >
                    Send
                  </button>
                </div>
              )}
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
