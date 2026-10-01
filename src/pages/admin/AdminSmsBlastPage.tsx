import { RefreshCw, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatCard } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'

const SMS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`
const MAX_LENGTH = 918

const AUDIENCES = [
  { id: 'all', label: 'All users', hint: 'Every user with a valid Ghana phone number' },
  { id: 'active', label: 'Active users', hint: 'Users whose account is active' },
  { id: 'api', label: 'API users', hint: 'Users with API access enabled' },
  { id: 'custom', label: 'Custom numbers only', hint: 'Only the numbers you paste below' },
] as const

type Audience = (typeof AUDIENCES)[number]['id']

type Campaign = {
  id: string
  message: string
  audience: Audience
  recipient_count: number
  created_at: string
  created_by_name: string | null
  pending: number
  sending: number
  sent: number
  failed: number
  skipped: number
  top_error: string | null
}

const GSM_CHARS =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€'
const GSM_EXTENDED = '^{}\\[~]|€'

function smsParts(text: string) {
  const chars = [...text]
  const gsm = chars.every((ch) => GSM_CHARS.includes(ch))
  const length = gsm ? chars.reduce((n, ch) => n + (GSM_EXTENDED.includes(ch) ? 2 : 1), 0) : chars.length
  const single = gsm ? 160 : 70
  const multi = gsm ? 153 : 67
  const parts = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi)
  return { length, parts, gsm }
}

function parseNumbers(raw: string) {
  return [...new Set(raw.split(/[\s,;]+/).map((n) => n.trim()).filter(Boolean))]
}

export default function AdminSmsBlastPage() {
  const { session } = useAuth()
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState<Audience>('all')
  const [numbersRaw, setNumbersRaw] = useState('')
  const [preview, setPreview] = useState<{ recipients: number; invalid_numbers: number } | null>(null)
  const [balance, setBalance] = useState<{ units: number | null; sender_id?: string; sms_enabled?: boolean } | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const dispatching = useRef(false)

  const numbers = useMemo(() => parseNumbers(numbersRaw), [numbersRaw])
  const parts = smsParts(message)
  const usesName = message.includes('{name}')
  const estimatedUnits = (preview?.recipients ?? 0) * Math.max(parts.parts, 1)

  const loadBalance = useCallback(async () => {
    if (!session?.access_token) return
    const res = await fetch(`${SMS_URL}/balance`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    if (body) setBalance({ units: body.units ?? null, sender_id: body.sender_id, sms_enabled: body.sms_enabled })
  }, [session?.access_token])

  const loadCampaigns = useCallback(async () => {
    const { data } = await supabase.rpc('admin_sms_campaigns', { p_limit: 50 })
    setCampaigns(((data ?? []) as Campaign[]).map((c) => ({
      ...c,
      pending: Number(c.pending),
      sending: Number(c.sending),
      sent: Number(c.sent),
      failed: Number(c.failed),
      skipped: Number(c.skipped),
    })))
    setLoadingCampaigns(false)
    return (data ?? []) as Campaign[]
  }, [])

  const dispatch = useCallback(async () => {
    if (dispatching.current) return
    dispatching.current = true
    try {
      for (let round = 0; round < 60; round++) {
        const res = await fetch(`${SMS_URL}/process?limit=50`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
        }).catch(() => null)
        const body = res ? await res.json().catch(() => null) : null
        const latest = await loadCampaigns()
        const stillPending = latest.some((c) => Number(c.pending) > 0)
        if (!body?.success || !body.processed || !stillPending) break
      }
    } finally {
      dispatching.current = false
      void loadBalance()
    }
  }, [loadCampaigns, loadBalance])

  useEffect(() => {
    void loadBalance()
    void loadCampaigns()
  }, [loadBalance, loadCampaigns])

  useEffect(() => {
    if (audience === 'custom' && numbers.length === 0) {
      setPreview({ recipients: 0, invalid_numbers: 0 })
      return
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('admin_sms_blast_preview', {
        p_audience: audience,
        p_numbers: numbers,
      })
      if (data?.success) setPreview({ recipients: data.recipients, invalid_numbers: data.invalid_numbers })
    }, 400)
    return () => clearTimeout(timer)
  }, [audience, numbers])

  const handleSend = async () => {
    const recipients = preview?.recipients ?? 0
    if (!message.trim() || recipients === 0) return
    if (!confirm(`Send this SMS to ${recipients} recipient(s)? This uses about ${estimatedUnits} SMS unit(s).`)) return

    setSending(true)
    setNotice(null)
    const { data, error } = await supabase.rpc('admin_create_sms_blast', {
      p_message: message,
      p_audience: audience,
      p_numbers: numbers,
    })
    setSending(false)

    if (error || !data?.success) {
      setNotice({ ok: false, text: error?.message ?? data?.error ?? 'Could not create SMS blast' })
      return
    }

    setNotice({ ok: true, text: `Queued ${data.recipients} SMS. Sending now…` })
    setMessage('')
    setNumbersRaw('')
    await loadCampaigns()
    void dispatch()
  }

  const handleCancel = async (id: string) => {
    if (!confirm('Stop sending the remaining messages in this blast?')) return
    await supabase.rpc('admin_cancel_sms_blast', { p_campaign_id: id })
    await loadCampaigns()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="SMS Blast"
        description="Send an SMS to your users through TXTConnect."
        action={
          <button
            type="button"
            onClick={() => {
              void loadBalance()
              void loadCampaigns()
            }}
            className="h-10 px-4 rounded-lg border border-white/10 text-sm font-bold inline-flex items-center gap-2 hover:bg-white/5"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          label="SMS units left"
          value={balance?.units == null ? '—' : balance.units.toLocaleString()}
          accent
        />
        <StatCard label="Sender ID" value={balance?.sender_id ?? '—'} />
        <StatCard
          label="Recipients"
          value={preview ? String(preview.recipients) : '—'}
          sub={preview ? `≈ ${estimatedUnits} unit(s) for this message` : undefined}
        />
      </div>

      {balance?.sms_enabled === false && (
        <p className="text-sm text-amber-400">
          SMS is turned off in Site Settings (sms_enabled). Blasts stay queued until it is turned back on.
        </p>
      )}

      <Panel title="Compose">
        <div className="space-y-5 max-w-2xl">
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Message</label>
              <button
                type="button"
                onClick={() => setMessage((m) => `${m}{name}`)}
                className="text-[11px] font-bold text-primary hover:underline"
              >
                Insert {'{name}'}
              </button>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
              rows={5}
              className="mt-1 w-full rounded-lg border border-white/10 bg-secondary/50 px-3 py-2 text-sm outline-none resize-none"
              placeholder="Hi {name}, MTN bundles are now cheaper on SwiftData. Top up and save today!"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              {parts.length} character(s) · {parts.parts} SMS part(s) per recipient
              {!parts.gsm && ' · contains special characters, so each part holds fewer characters'}
              {usesName && ' · {name} becomes each user’s first name ("Customer" for custom numbers)'}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Send to</label>
            <div className="mt-2 grid sm:grid-cols-2 gap-2">
              {AUDIENCES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAudience(a.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    audience === a.id
                      ? 'border-red-500/50 bg-red-500/10 ring-1 ring-red-500/30'
                      : 'border-white/10 bg-secondary/30 hover:bg-secondary/50'
                  }`}
                >
                  <p className="text-sm font-semibold">{a.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{a.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {audience === 'custom' ? 'Phone numbers' : 'Extra phone numbers (optional)'}
            </label>
            <textarea
              value={numbersRaw}
              onChange={(e) => setNumbersRaw(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-white/10 bg-secondary/50 px-3 py-2 text-sm font-mono outline-none resize-none"
              placeholder="0241234567, 0551234567 — separate with commas, spaces or new lines"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Duplicates are removed automatically.
              {preview && preview.invalid_numbers > 0 && (
                <span className="text-amber-400"> {preview.invalid_numbers} number(s) are not valid Ghana numbers and will be skipped.</span>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !message.trim() || !preview?.recipients}
            className="h-10 px-6 rounded-lg bg-red-500 text-white font-bold inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {sending ? 'Queuing…' : `Send to ${preview?.recipients ?? 0} recipient(s)`}
          </button>
          {notice && (
            <p className={`text-sm ${notice.ok ? 'text-emerald-400' : 'text-destructive'}`}>{notice.text}</p>
          )}
        </div>
      </Panel>

      <Panel title="Blast history" description={`${campaigns.length} blast(s)`}>
        {loadingCampaigns ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : campaigns.length === 0 ? (
          <EmptyState title="No SMS blasts yet" description="Compose your first message above." />
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => {
              const done = c.sent + c.failed + c.skipped
              const pct = c.recipient_count ? Math.round((done / c.recipient_count) * 100) : 0
              const inProgress = c.pending > 0 || c.sending > 0
              return (
                <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <p className="text-sm whitespace-pre-wrap break-words min-w-0 flex-1">{c.message}</p>
                    <div className="text-[11px] text-muted-foreground shrink-0 sm:text-right">
                      <p>{formatDate(c.created_at)}</p>
                      <p>
                        {AUDIENCES.find((a) => a.id === c.audience)?.label ?? c.audience}
                        {c.created_by_name ? ` · by ${c.created_by_name}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span>{c.recipient_count} recipient(s)</span>
                    <span className="text-emerald-400">{c.sent} sent</span>
                    {c.failed > 0 && <span className="text-red-400">{c.failed} failed</span>}
                    {c.skipped > 0 && <span className="text-muted-foreground">{c.skipped} cancelled</span>}
                    {inProgress && <span className="text-amber-400">{c.pending + c.sending} waiting</span>}
                    {inProgress && (
                      <span className="flex gap-3 ml-auto">
                        <button
                          type="button"
                          onClick={() => void dispatch()}
                          className="font-bold text-primary hover:underline"
                        >
                          Resume sending
                        </button>
                        {c.pending > 0 && (
                          <button
                            type="button"
                            onClick={() => void handleCancel(c.id)}
                            className="font-bold text-destructive hover:underline"
                          >
                            Cancel
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  {c.top_error && <p className="text-[11px] text-red-400">Most common error: {c.top_error}</p>}
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}
