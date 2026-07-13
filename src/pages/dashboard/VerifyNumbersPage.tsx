import { CheckCircle2, Loader2, Send, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/format'
import {
  checkNumbers,
  requestNumberVerification,
  type NumberCheckResult,
} from '../../lib/numberVerification'
import { supabase } from '../../lib/supabase'
import type { NumberVerification } from '../../types/database'

function normalizePhone(raw: string): string {
  let phone = raw.trim().replace(/[\s\-()]/g, '')
  if (phone.startsWith('+233')) phone = `0${phone.slice(4)}`
  else if (phone.startsWith('233') && phone.length === 12) phone = `0${phone.slice(3)}`
  return phone
}

function parsePhones(text: string): string[] {
  const parts = text.split(/[\n,;]+/).map((p) => normalizePhone(p)).filter(Boolean)
  return [...new Set(parts)]
}

export default function VerifyNumbersPage() {
  const { user, session } = useAuth()
  const [input, setInput] = useState('')
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

  const unverifiedResults = useMemo(
    () => results.filter((r) => r.valid && !r.verified && r.status !== 'pending' && r.status !== 'submitted'),
    [results],
  )

  const runCheck = async () => {
    const phones = parsePhones(input)
    if (phones.length === 0) {
      setError('Enter at least one Ghana phone number (e.g. 0241234567)')
      return
    }
    if (phones.length > 50) {
      setError('Maximum 50 numbers per check')
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
      setMessage(
        `Checked ${data.checked} — ${data.verified} verified, ${data.unverified} not verified`,
      )
      const autoSelect = new Set(
        (data.results ?? [])
          .filter((r) => r.valid && !r.verified)
          .map((r) => r.phone),
      )
      setSelected(autoSelect)
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
      const data = await requestNumberVerification(phones, session.access_token)
      if (!data.success) {
        setError(data.error ?? 'Could not submit verification request')
        return
      }
      setMessage(`Sent ${phones.length} number(s) for verification. Track status below.`)
      setSelected(new Set())
      await loadHistory()
      setResults((prev) =>
        prev.map((r) =>
          phones.includes(r.phone) && !r.verified
            ? { ...r, status: 'pending', message: 'Submitted for verification' }
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
        description="Check whether MTN contacts are on the verified beneficiary list. Unverified numbers can be sent for verification."
      />

      <Panel title="Check contacts" description="Paste one number per line, or separate with commas. Checks MTN (Yello) beneficiary eligibility.">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
          placeholder={'0241234567\n0549876543\n0201112233'}
          className="w-full rounded-xl border border-white/10 bg-secondary/50 px-4 py-3 text-sm font-mono outline-none resize-y"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={checking}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60"
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {checking ? 'Checking…' : 'Check numbers'}
          </button>
          {unverifiedResults.length > 0 && (
            <button
              type="button"
              onClick={() => void sendForVerification([...selected].filter((p) => unverifiedResults.some((r) => r.phone === p)))}
              disabled={requesting || selected.size === 0}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-lg border border-white/10 bg-secondary/50 text-sm font-bold disabled:opacity-60"
            >
              {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send selected for verification ({selected.size})
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        {message && <p className="text-sm text-emerald-400 mt-3">{message}</p>}
      </Panel>

      {results.length > 0 && (
        <Panel title="Check results">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="py-2 pr-3 w-8" />
                  <th className="py-2 pr-3 font-medium">Phone</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {results.map((r) => (
                  <tr key={r.phone}>
                    <td className="py-2.5 pr-3">
                      {r.valid && !r.verified ? (
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
                      {r.verified ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-bold">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                        </span>
                      ) : r.status === 'invalid' ? (
                        <span className="inline-flex items-center gap-1 text-red-400 text-xs font-bold">
                          <XCircle className="h-3.5 w-3.5" /> Invalid
                        </span>
                      ) : r.status === 'pending' || r.status === 'submitted' ? (
                        <span className="inline-flex items-center gap-1 text-amber-400 text-xs font-bold">
                          <ShieldAlert className="h-3.5 w-3.5" /> {r.status}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-400 text-xs font-bold">
                          <ShieldAlert className="h-3.5 w-3.5" /> Not verified
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-muted-foreground text-xs">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Your verification history" description="Numbers you have checked or submitted for verification.">
        {history.length === 0 ? (
          <EmptyState title="No checks yet" description="Verify a contact above to start building your list." />
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