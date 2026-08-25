import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collectVerifyPhones,
  NumberVerificationInput,
  type VerifyInputMode,
} from '../../components/NumberVerificationInput'
import { MTN_VERIFY_HINT } from '../../components/NumberVerificationSubmitForm'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/format'
import {
  checkNumbers,
  submitNumbersForVerification,
  syncVerificationStatuses,
  type NumberCheckResult,
} from '../../lib/numberVerification'
import { supabase } from '../../lib/supabase'
import type { NumberVerification } from '../../types/database'

const SYNC_MS = 15_000
const OPEN_STATUSES = new Set(['pending', 'submitted'])

function statusTone(status: string) {
  if (status === 'verified') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
  if (status === 'failed' || status === 'invalid' || status === 'error') {
    return 'text-red-400 bg-red-500/10 border-red-500/30'
  }
  if (status === 'unverified') return 'text-amber-400 bg-amber-500/10 border-amber-500/30'
  return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
}

function statusLabel(result: NumberCheckResult) {
  if (result.status === 'verified' || result.verified) return 'Verified'
  if (result.status === 'invalid') return 'Invalid'
  if (result.status === 'error') return 'Error'
  if (result.status === 'failed') return 'Failed'
  if (result.status === 'unverified') return 'Unverified'
  if (result.status === 'submitted' || result.status === 'pending') return 'Pending approval'
  if (result.recommendation === 'activate_first') return 'Needs activation'
  if (result.recommendation === 'sell_any') return 'Ready to sell'
  return result.status
}

function recommendationHint(result: NumberCheckResult) {
  if (result.recommendation === 'sell_any') return 'You can sell data to this number now.'
  if (result.recommendation === 'activate_first') {
    return 'Submit for beneficiary approval, then retry in 5–15 minutes.'
  }
  return result.message
}

function mergeResult(prev: NumberCheckResult, row: NumberVerification): NumberCheckResult {
  const verified = row.status === 'verified'
  return {
    ...prev,
    verified,
    status: row.status,
    message: row.provider_message ?? prev.message,
    provider_name: row.provider_name ?? prev.provider_name,
    provider_exists: row.provider_exists ?? prev.provider_exists,
    recommendation: verified ? 'sell_any' : prev.recommendation,
    servable: verified ? true : prev.servable,
  }
}

export default function VerifyNumbersPage() {
  const { user, session } = useAuth()
  const [inputMode, setInputMode] = useState<VerifyInputMode>('single')
  const [singlePhone, setSinglePhone] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [history, setHistory] = useState<NumberVerification[]>([])
  const [liveResults, setLiveResults] = useState<NumberCheckResult[]>([])
  const [watchPhones, setWatchPhones] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const syncingRef = useRef(false)

  const phones = useMemo(
    () => collectVerifyPhones(inputMode, singlePhone, bulkText),
    [inputMode, singlePhone, bulkText],
  )

  const loadHistory = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('number_verifications')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(200)
    setHistory((data as NumberVerification[]) ?? [])
  }, [user])

  const syncWatchPhones = useCallback(async () => {
    if (!session?.access_token || watchPhones.length === 0 || syncingRef.current) return
    syncingRef.current = true
    try {
      const data = await syncVerificationStatuses(session.access_token, watchPhones)
      if (data.results?.length) {
        setLiveResults((prev) => {
          const map = new Map(prev.map((r) => [r.phone, r]))
          for (const r of data.results!) map.set(r.phone, { ...map.get(r.phone)!, ...r })
          return [...map.values()]
        })
      }
      await loadHistory()
    } catch {
      /* background */
    } finally {
      syncingRef.current = false
    }
  }, [session?.access_token, watchPhones, loadHistory])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`number-verifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'number_verifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as NumberVerification | undefined
          if (!row?.phone) {
            void loadHistory()
            return
          }
          setLiveResults((prev) =>
            prev.map((r) => (r.phone === row.phone ? mergeResult(r, row) : r)),
          )
          void loadHistory()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user, loadHistory])

  useEffect(() => {
    if (!session?.access_token || watchPhones.length === 0) return
    void syncWatchPhones()
    const id = window.setInterval(() => void syncWatchPhones(), SYNC_MS)
    return () => window.clearInterval(id)
  }, [session?.access_token, watchPhones, syncWatchPhones])

  const resultStats = useMemo(() => {
    const verified = liveResults.filter((r) => r.verified || r.status === 'verified').length
    const pending = liveResults.filter((r) => OPEN_STATUSES.has(r.status)).length
    const unverified = liveResults.filter(
      (r) => r.status === 'unverified' || r.recommendation === 'activate_first',
    ).length
    const invalid = liveResults.filter((r) => !r.valid || r.status === 'invalid').length
    return { verified, pending, unverified, invalid, total: liveResults.length }
  }, [liveResults])

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return history
    return history.filter(
      (row) => row.phone.toLowerCase().includes(q) || row.status.toLowerCase().includes(q),
    )
  }, [history, search])

  const historyCounts = useMemo(
    () => ({
      verified: history.filter((h) => h.status === 'verified').length,
      pending: history.filter((h) => h.status === 'submitted' || h.status === 'pending').length,
      failed: history.filter((h) => h.status === 'failed' || h.status === 'unverified').length,
    }),
    [history],
  )

  const doCheck = async () => {
    if (!session?.access_token) {
      setError('Please sign in again')
      return
    }
    if (phones.length === 0) {
      setError(`Enter at least one valid MTN number (${MTN_VERIFY_HINT})`)
      return
    }
    if (phones.length > 100) {
      setError('Maximum 100 numbers per check')
      return
    }

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const data = await checkNumbers(phones, session.access_token)
      if (!data.success) {
        setError(data.error ?? 'Status check failed')
        return
      }
      const results = data.results ?? []
      setLiveResults(results)
      const open = results
        .filter((r) => r.valid && (OPEN_STATUSES.has(r.status) || r.recommendation === 'activate_first'))
        .map((r) => r.phone)
      setWatchPhones(open)
      setMessage(
        `${data.checked ?? phones.length} checked · ${data.verified ?? 0} verified · ${data.activate_first ?? data.unverified ?? 0} need activation`,
      )
      await loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doSubmit = async () => {
    if (!session?.access_token) {
      setError('Please sign in again')
      return
    }
    if (phones.length === 0) {
      setError(`Enter at least one valid MTN number (${MTN_VERIFY_HINT})`)
      return
    }

    setConfirmSubmit(false)
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const data = await submitNumbersForVerification(phones, session.access_token)
      if (!data.success) {
        setError(data.error ?? 'Submission failed')
        return
      }
      const results = data.check.results ?? []
      setLiveResults(results)
      const open = results
        .filter((r) => r.valid && OPEN_STATUSES.has(r.status))
        .map((r) => r.phone)
      setWatchPhones((prev) => [...new Set([...prev, ...open])])
      setMessage(
        `${data.check.checked ?? phones.length} checked · ${data.verified} verified · ${data.submitted} submitted for approval`,
      )
      await loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const refreshResults = async () => {
    if (!session?.access_token) return
    const toSync = watchPhones.length > 0 ? watchPhones : phones
    if (toSync.length === 0) {
      setError('Check some numbers first')
      return
    }
    setRefreshing(true)
    setError(null)
    try {
      const data = await syncVerificationStatuses(session.access_token, toSync)
      if (!data.success) {
        setError(data.error ?? 'Refresh failed')
        return
      }
      if (data.results?.length) {
        setLiveResults((prev) => {
          const map = new Map(prev.map((r) => [r.phone, r]))
          for (const r of data.results!) {
            if (map.has(r.phone)) map.set(r.phone, { ...map.get(r.phone)!, ...r })
            else map.set(r.phone, r)
          }
          return [...map.values()]
        })
      }
      setMessage(`Synced ${data.synced ?? 0} · ${data.verified ?? 0} now verified`)
      await loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6 pb-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-primary/10 p-4 sm:p-5 border border-blue-500/20">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg sm:text-2xl font-black tracking-tight">Verify Numbers</h1>
            <span className="text-blue-300 border border-blue-500/30 bg-blue-500/10 text-[9px] sm:text-xs px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1">
              <Radio className="w-3 h-3" /> Live status
            </span>
          </div>
        </div>
        <p className="text-[11px] sm:text-sm leading-snug mt-2 text-muted-foreground">
          Check one number, paste a bulk list, or upload an Excel file. Status updates automatically
          for pending approvals ({MTN_VERIFY_HINT}).
        </p>
      </div>

      <div className="border border-white/10 shadow-xl rounded-2xl overflow-hidden bg-white/[0.03] backdrop-blur-xl">
        <div className="px-4 sm:px-5 pt-4 pb-2 border-b border-white/5">
          <p className="text-xs sm:text-sm font-bold">Enter numbers</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
            Single, bulk paste, or Excel / CSV upload
          </p>
        </div>
        <div className="p-4 sm:p-5 space-y-4">
          <NumberVerificationInput
            mode={inputMode}
            onModeChange={setInputMode}
            singlePhone={singlePhone}
            onSinglePhoneChange={setSinglePhone}
            bulkText={bulkText}
            onBulkTextChange={setBulkText}
            disabled={busy}
          />

          {error && <p className="text-sm text-red-400">{error}</p>}
          {message && <p className="text-sm text-emerald-400">{message}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || phones.length === 0}
              onClick={() => void doCheck()}
              className="h-11 rounded-xl font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border border-emerald-400/30 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Checking…
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" /> Check status
                </>
              )}
            </button>
            <button
              type="button"
              disabled={busy || phones.length === 0}
              onClick={() => setConfirmSubmit(true)}
              className="h-11 rounded-xl font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border border-blue-400/30 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" /> Submit for approval
            </button>
          </div>
        </div>
      </div>

      {liveResults.length > 0 && (
        <div className="border border-white/10 shadow-xl rounded-2xl overflow-hidden bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2 px-4 sm:px-5 pt-4 pb-2 border-b border-white/5">
            <div>
              <p className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> Live results
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {watchPhones.length > 0
                  ? 'Watching pending numbers — updates appear automatically'
                  : 'Latest check results'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshResults()}
              disabled={refreshing || busy}
              className="flex items-center gap-1 text-[10px] font-bold text-amber-400 hover:text-amber-300 disabled:opacity-50"
            >
              {refreshing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}{' '}
              Refresh
            </button>
          </div>

          <div className="p-4 sm:p-5 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['Verified', resultStats.verified, 'text-emerald-400'],
                ['Pending', resultStats.pending, 'text-blue-400'],
                ['Unverified', resultStats.unverified, 'text-amber-400'],
                ['Invalid', resultStats.invalid, 'text-red-400'],
              ].map(([label, value, tone]) => (
                <div
                  key={label}
                  className="p-2.5 rounded-xl bg-black/30 border border-white/5 text-center"
                >
                  <p className={`text-[9px] font-bold uppercase tracking-wider ${tone}`}>{label}</p>
                  <p className={`text-lg font-black ${tone}`}>{value}</p>
                </div>
              ))}
            </div>

            <div className="max-h-80 overflow-y-auto space-y-2">
              {liveResults.map((row) => (
                <div
                  key={row.phone}
                  className="rounded-xl border border-white/5 bg-black/30 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      {row.verified || row.status === 'verified' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : OPEN_STATUSES.has(row.status) ? (
                        <Loader2 className="w-4 h-4 text-blue-400 shrink-0 animate-spin" />
                      ) : row.valid ? (
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      <span className="font-mono font-bold text-sm">{row.phone}</span>
                    </div>
                    <span
                      className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusTone(row.status)}`}
                    >
                      {statusLabel(row)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {recommendationHint(row)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="border border-white/10 shadow-xl rounded-2xl overflow-hidden bg-white/[0.03]">
        <div className="px-4 sm:px-5 pt-4 pb-2 border-b border-white/5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-amber-500" /> My numbers
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Previously checked or submitted numbers
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          {history.length > 0 && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your numbers..."
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-white/10 bg-black/40 outline-none focus:ring-1 focus:ring-amber-500/50"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                    Verified
                  </p>
                  <p className="text-base font-black text-emerald-400">{historyCounts.verified}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-blue-400">Pending</p>
                  <p className="text-base font-black text-blue-400">{historyCounts.pending}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-red-400">Failed</p>
                  <p className="text-base font-black text-red-400">{historyCounts.failed}</p>
                </div>
              </div>
            </>
          )}

          {filteredHistory.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              {history.length === 0
                ? 'No numbers checked yet — results will appear here.'
                : 'No numbers match your search.'}
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {filteredHistory.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-white/5 bg-white/5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {row.status === 'verified' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : row.status === 'failed' || row.status === 'unverified' ? (
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    ) : (
                      <Loader2 className="w-3.5 h-3.5 text-blue-400 shrink-0 animate-spin" />
                    )}
                    <span className="font-mono font-bold truncate">{row.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[9px] font-black uppercase tracking-wider ${statusTone(row.status).split(' ')[0]}`}
                    >
                      {row.status === 'verified' ? 'Verified' : row.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDate(row.updated_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmSubmit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0c0c10] p-5 shadow-2xl space-y-3">
            <h2 className="text-base sm:text-xl font-extrabold">Submit for approval?</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Submit <strong className="text-foreground">{phones.length}</strong> unverified number
              {phones.length === 1 ? '' : 's'} for MTN beneficiary whitelisting. Already-verified
              numbers are skipped.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmSubmit(false)}
                className="h-9 px-4 rounded-xl text-xs font-semibold border border-white/10 text-muted-foreground hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void doSubmit()}
                className="h-9 px-4 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white"
              >
                Confirm submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
