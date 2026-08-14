import { CheckCircle2, Loader2, Send, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/format'
import {
  checkNumbers,
  isMtnPhone,
  requestNumberVerification,
  type NumberCheckResult,
} from '../../lib/numberVerification'
import { supabase } from '../../lib/supabase'
import type { NumberVerification } from '../../types/database'

function normalizePhone(raw: string): string {
  let phone = raw.trim().replace(/[\s\-()]/g, '')
  if (phone.startsWith('+233')) phone = `0${phone.slice(4)}`
  else if (phone.startsWith('233') && phone.length >= 12) phone = `0${phone.slice(3)}`
  else if (/^[2-5]\d{8}$/.test(phone)) phone = `0${phone}`
  return phone
}

function parsePhones(text: string): string[] {
  const parts = text.split(/[\n,;]+/).map((p) => normalizePhone(p)).filter(Boolean)
  return [...new Set(parts)]
}

function resultLabel(r: NumberCheckResult) {
  if (r.recommendation === 'sell_any' || r.verified) {
    return { text: 'Sell any size', tone: 'text-emerald-400', icon: CheckCircle2 }
  }
  if (r.recommendation === 'activate_first' || r.status === 'unverified') {
    return { text: 'Activate first', tone: 'text-amber-400', icon: ShieldAlert }
  }
  if (r.status === 'invalid') {
    return { text: 'Invalid / not MTN', tone: 'text-red-400', icon: XCircle }
  }
  if (r.status === 'pending' || r.status === 'submitted') {
    return { text: r.status, tone: 'text-amber-400', icon: ShieldAlert }
  }
  if (r.status === 'error') {
    return { text: 'Error', tone: 'text-red-400', icon: XCircle }
  }
  return { text: r.status, tone: 'text-muted-foreground', icon: ShieldAlert }
}

export default function VerifyNumbersPage() {
  const { user, session } = useAuth()
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [singlePhone, setSinglePhone] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [results, setResults] = useState<NumberCheckResult[]>([])
  const [history, setHistory] = useState<NumberVerification[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const loadHistory = async () => {
    if (!user) return
    const { data } = await supabase
      .from('number_verifications')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(100)
    setHistory((data as NumberVerification[]) ?? [])
  }

  useEffect(() => {
    void loadHistory()
  }, [user?.id])

  const needsFollowUp = useMemo(
    () =>
      results.filter(
        (r) =>
          r.valid &&
          !r.verified &&
          (r.recommendation === 'activate_first' || r.status === 'unverified') &&
          r.status !== 'pending' &&
          r.status !== 'submitted',
      ),
    [results],
  )

  const runCheck = async () => {
    const phones =
      mode === 'single'
        ? [normalizePhone(singlePhone)].filter(Boolean)
        : parsePhones(bulkInput)

    if (phones.length === 0) {
      setError('Enter at least one MTN number (024, 025, 053, 054, 055, 059)')
      return
    }
    if (phones.length > 100) {
      setError('Maximum 100 numbers per bulk check')
      return
    }

    const nonMtn = phones.filter((p) => !isMtnPhone(p) && /^0[2-5]\d{8}$/.test(p))
    if (mode === 'single' && phones[0] && !isMtnPhone(phones[0])) {
      setError('Only MTN numbers are supported (024, 025, 053, 054, 055, 059)')
      return
    }

    setChecking(true)
    setError(null)
    setMessage(null)
    setSelected(new Set())

    try {
      const data = await checkNumbers(phones, session?.access_token)
      if (!data.success) {
        setError(data.error ?? 'Verification check failed')
        setResults([])
        return
      }
      setResults(data.results ?? [])
      const skipped = nonMtn.length
      setMessage(
        `Checked ${data.checked} — ${data.sell_any ?? data.verified} sell any, ${data.activate_first ?? data.unverified} activate first` +
          (skipped ? ` · ${skipped} non-MTN flagged locally` : ''),
      )
      setSelected(
        new Set(
          (data.results ?? [])
            .filter((r) => r.valid && !r.verified && r.recommendation === 'activate_first')
            .map((r) => r.phone),
        ),
      )
      await loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  const sendForVerification = async (phones: string[]) => {
    if (!session?.access_token || phones.length === 0) return
    setRequesting(true)
    setError(null)
    setMessage(null)

    try {
      const data = await requestNumberVerification(
        phones,
        session.access_token,
        'Needs MTN activation (Datahub beneficiary list)',
      )
      if (!data.success) {
        setError(data.error ?? 'Could not submit verification request')
        return
      }
      setMessage(
        `Submitted ${phones.length} number(s) to Datahub for beneficiary approval.`,
      )
      setSelected(new Set())
      await loadHistory()
      setResults((prev) =>
        prev.map((r) =>
          phones.includes(r.phone) && !r.verified
            ? { ...r, status: 'pending', message: 'Queued for activation follow-up' }
            : r,
        ),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRequesting(false)
    }
  }

  const togglePhone = (phone: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(phone)) next.delete(phone)
      else next.add(phone)
      return next
    })
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Verify Numbers"
        description="Pre-check MTN numbers with Datahub before selling data. Unverified numbers are submitted for beneficiary approval automatically."
      />

      <Panel
        title="Check MTN numbers"
        description="MTN prefixes 024 / 025 / 053 / 054 / 055 / 059. Single check or bulk (up to 100)."
      >
        <div className="flex flex-wrap gap-2 mb-4">
          {(['single', 'bulk'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`h-9 rounded-lg border px-3 text-sm capitalize ${
                mode === m
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-white/10 bg-secondary/50'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === 'single' ? (
          <input
            value={singlePhone}
            onChange={(e) => setSinglePhone(e.target.value)}
            placeholder="0241234567"
            className="w-full max-w-sm h-11 rounded-xl border border-white/10 bg-secondary/50 px-4 text-sm font-mono outline-none"
          />
        ) : (
          <textarea
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            rows={6}
            placeholder={'0241234567\n0549876543\n0551112233'}
            className="w-full rounded-xl border border-white/10 bg-secondary/50 px-4 py-3 text-sm font-mono outline-none resize-y"
          />
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={checking}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60"
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {checking ? 'Checking…' : mode === 'bulk' ? 'Bulk verify' : 'Verify number'}
          </button>
          {needsFollowUp.length > 0 && (
            <button
              type="button"
              onClick={() =>
                void sendForVerification(
                  [...selected].filter((p) => needsFollowUp.some((r) => r.phone === p)),
                )
              }
              disabled={requesting || selected.size === 0}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-lg border border-white/10 bg-secondary/50 text-sm font-bold disabled:opacity-60"
            >
              {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit to Datahub ({selected.size})
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        {message && <p className="text-sm text-emerald-400 mt-3">{message}</p>}
      </Panel>

      {results.length > 0 && (
        <Panel title="Results">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="py-2 pr-3 w-8" />
                  <th className="py-2 pr-3 font-medium">Phone</th>
                  <th className="py-2 pr-3 font-medium">Recommendation</th>
                  <th className="py-2 font-medium">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {results.map((r) => {
                  const label = resultLabel(r)
                  const Icon = label.icon
                  return (
                    <tr key={r.phone}>
                      <td className="py-2.5 pr-3">
                        {r.valid && !r.verified && r.recommendation === 'activate_first' ? (
                          <input
                            type="checkbox"
                            checked={selected.has(r.phone)}
                            onChange={() => togglePhone(r.phone)}
                            className="rounded border-white/20"
                          />
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 font-mono">{r.phone || '—'}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${label.tone}`}>
                          <Icon className="h-3.5 w-3.5" /> {label.text}
                        </span>
                      </td>
                      <td className="py-2.5 text-muted-foreground text-xs">{r.message}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Your verification history" description="Past MTN checks and activation follow-ups.">
        {history.length === 0 ? (
          <EmptyState title="No checks yet" description="Verify an MTN number above to start building your list." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="py-2 pr-3 font-medium">Phone</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Last checked</th>
                  <th className="py-2 font-medium">Requested</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {history.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2.5 pr-3 font-mono">{row.phone}</td>
                    <td className="py-2.5 pr-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground text-xs">
                      {row.checked_at ? formatDate(row.checked_at) : '—'}
                    </td>
                    <td className="py-2.5 text-muted-foreground text-xs">
                      {row.requested_at ? formatDate(row.requested_at) : '—'}
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
