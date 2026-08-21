import * as XLSX from 'xlsx'
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Copy,
  FileSpreadsheet,
  History,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isAllowedMtnVerifyPhone,
  MTN_VERIFY_HINT,
  normalizeVerifyPhone,
  parseVerifyPhones,
} from '../../components/NumberVerificationSubmitForm'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/format'
import {
  submitNumbersForVerification,
  syncVerificationStatuses,
} from '../../lib/numberVerification'
import { supabase } from '../../lib/supabase'
import type { NumberVerification } from '../../types/database'

const SYNC_MS = 20_000
const SAMPLE = '0538122730\n0241234567\n0554226398'

type ExtractedFile = {
  fileName: string
  validNumbers: string[]
  totalScanned: number
  invalidCount: number
}

type SubmitSummary = {
  message: string
  submitted: number
  verified: number
  numbers: string[]
}

function statusTone(status: string) {
  if (status === 'verified') return 'text-emerald-400'
  if (status === 'failed') return 'text-red-400'
  if (status === 'unverified') return 'text-amber-400'
  return 'text-blue-400'
}

function statusLabel(status: string) {
  if (status === 'verified') return 'whitelisted'
  if (status === 'unverified') return 'unverified'
  if (status === 'submitted' || status === 'pending') return 'pending'
  return status
}

function analyzeText(text: string) {
  const parts = text
    .split(/[\n,;]+/)
    .map((p) => normalizeVerifyPhone(p))
    .filter(Boolean)
  const unique = [...new Set(parts)]
  const valid = unique.filter(isAllowedMtnVerifyPhone)
  const invalid = unique.filter((p) => !isAllowedMtnVerifyPhone(p))
  return { valid, invalid, total: unique.length }
}

function extractNumbersFromWorkbook(buffer: ArrayBuffer): { phones: string[]; scanned: number } {
  const wb = XLSX.read(buffer, { type: 'array' })
  const phones: string[] = []
  let scanned = 0
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    })
    for (const row of rows) {
      for (const cell of row) {
        const raw = String(cell ?? '').trim()
        if (!raw) continue
        scanned += 1
        const phone = normalizeVerifyPhone(raw)
        if (phone) phones.push(phone)
      }
    }
  }
  return { phones, scanned }
}

export default function VerifyNumbersPage() {
  const { user, session } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedFile | null>(null)
  const [history, setHistory] = useState<NumberVerification[]>([])
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<SubmitSummary | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const syncingRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const analysis = useMemo(() => analyzeText(text), [text])

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

  const syncFromDatahub = useCallback(async () => {
    if (!session?.access_token || syncingRef.current) return
    syncingRef.current = true
    try {
      await syncVerificationStatuses(session.access_token)
      await loadHistory()
    } catch {
      /* background */
    } finally {
      syncingRef.current = false
    }
  }, [session?.access_token, loadHistory])

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
        () => {
          void loadHistory()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user, loadHistory])

  useEffect(() => {
    if (!session?.access_token) return
    void syncFromDatahub()
    const id = window.setInterval(() => void syncFromDatahub(), SYNC_MS)
    return () => window.clearInterval(id)
  }, [session?.access_token, syncFromDatahub])

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return history
    return history.filter(
      (row) => row.phone.toLowerCase().includes(q) || row.status.toLowerCase().includes(q),
    )
  }, [history, search])

  const counts = useMemo(
    () => ({
      verified: history.filter((h) => h.status === 'verified').length,
      pending: history.filter((h) => h.status === 'submitted' || h.status === 'pending').length,
      failed: history.filter((h) => h.status === 'failed' || h.status === 'unverified').length,
    }),
    [history],
  )

  const formatText = () => {
    const phones = parseVerifyPhones(text)
    setText(phones.join('\n'))
  }

  const clearText = () => {
    setText('')
    setExtracted(null)
    setError(null)
  }

  const downloadSample = () => {
    const ws = XLSX.utils.aoa_to_sheet([['phone'], ['0538122730'], ['0241234567'], ['0554226398']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Numbers')
    XLSX.writeFile(wb, 'mtn-numbers-sample.xlsx')
  }

  const handleFile = async (file: File) => {
    const name = file.name.toLowerCase()
    if (!/\.(xlsx|xls|csv|tsv|txt)$/.test(name)) {
      setError('Please upload an Excel (.xlsx, .xls) or CSV/TXT file.')
      return
    }
    setParsing(true)
    setError(null)
    try {
      const buffer = await file.arrayBuffer()
      let phones: string[] = []
      let scanned = 0
      if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
        const raw = new TextDecoder().decode(buffer)
        const parts = raw.split(/[\n,;\t]+/).map((p) => normalizeVerifyPhone(p)).filter(Boolean)
        scanned = parts.length
        phones = parts
      } else {
        const extractedRows = extractNumbersFromWorkbook(buffer)
        phones = extractedRows.phones
        scanned = extractedRows.scanned
      }
      const unique = [...new Set(phones)]
      const valid = unique.filter(isAllowedMtnVerifyPhone)
      const invalidCount = unique.length - valid.length
      if (valid.length === 0) {
        setError(`Scanned ${scanned} cells in ${file.name}, but found no valid MTN numbers (${MTN_VERIFY_HINT}).`)
        setExtracted(null)
        return
      }
      setExtracted({
        fileName: file.name,
        validNumbers: valid,
        totalScanned: scanned,
        invalidCount,
      })
      setMessage(`Extracted ${valid.length} valid number(s) from ${file.name}.`)
    } catch (e) {
      setError((e as Error).message || 'Failed to parse file')
      setExtracted(null)
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const applyExtracted = (mode: 'replace' | 'append') => {
    if (!extracted) return
    setText((prev) => {
      const next =
        mode === 'replace'
          ? extracted.validNumbers
          : [...new Set([...parseVerifyPhones(prev), ...extracted.validNumbers])]
      return next.join('\n')
    })
    setExtracted(null)
  }

  const doSubmit = async () => {
    if (!session?.access_token) {
      setError('Please sign in again')
      return
    }
    const phones = analysis.valid
    if (phones.length === 0) {
      setError(`Enter at least one MTN number (${MTN_VERIFY_HINT})`)
      return
    }
    setConfirmOpen(false)
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const data = await submitNumbersForVerification(phones, session.access_token)
      if (!data.success) {
        setError(data.error ?? 'Submission failed')
        setSummary(null)
        return
      }
      const submittedPhones = (data.check.results ?? [])
        .filter((r) => r.valid)
        .map((r) => r.phone)
      setSummary({
        message: `${data.check.checked ?? phones.length} checked · ${data.verified} verified · ${data.submitted} submitted for approval`,
        submitted: data.submitted ?? 0,
        verified: data.verified ?? 0,
        numbers: submittedPhones.length ? submittedPhones : phones,
      })
      setMessage(
        `${data.check.checked ?? phones.length} checked · ${data.verified} verified · ${data.submitted} submitted`,
      )
      await loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const refreshOpenStatuses = async () => {
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
      await loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  const copyList = async (list: string[]) => {
    await navigator.clipboard.writeText(list.join('\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-3 sm:space-y-6 pb-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-primary/10 p-3 sm:p-5 border border-amber-500/20 backdrop-blur-xl shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base sm:text-2xl font-black tracking-tight">Submit Numbers</h1>
            <span className="text-amber-400 border border-amber-500/30 bg-amber-500/10 text-[9px] sm:text-xs px-2 py-0.5 rounded-full font-bold">
              Beneficiary Approval
            </span>
          </div>
          <span className="text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 text-[9px] px-2 py-0.5 rounded-full font-bold">
            Account
          </span>
        </div>
        <p className="text-[11px] sm:text-xs leading-snug mt-1.5 text-muted-foreground">
          Paste or upload MTN numbers ({MTN_VERIFY_HINT}) for beneficiary whitelisting. Status updates
          automatically.
        </p>
      </div>

      <div className="p-3.5 sm:p-4 rounded-2xl border bg-amber-500/10 border-amber-500/20 text-amber-200 space-y-2.5">
        <div className="flex items-center gap-2 font-black text-xs sm:text-sm tracking-wide">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Smart 3-Step Beneficiary Activation Guide</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] sm:text-xs">
          {[
            {
              n: '1',
              title: 'Paste Phone Number',
              body: 'Enter your MTN number in the box below or upload an Excel file.',
            },
            {
              n: '2',
              title: 'Tap Submit for Approval',
              body: 'Your number is queued for carrier whitelisting.',
            },
            {
              n: '3',
              title: 'Retry Order (5–15 mins)',
              body: 'Once approved, retry your order for instant delivery.',
            },
          ].map((step) => (
            <div
              key={step.n}
              className="p-2.5 rounded-xl border bg-black/30 border-white/5 flex items-start gap-2"
            >
              <span className="w-5 h-5 rounded-full bg-amber-500 text-black font-black text-[10px] flex items-center justify-center shrink-0">
                {step.n}
              </span>
              <div>
                <p className="font-bold text-amber-100">{step.title}</p>
                <p className="opacity-75 text-[10px] text-amber-100/80">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-white/10 shadow-xl rounded-2xl overflow-hidden bg-white/[0.03] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2 px-3 sm:px-5 pt-3 pb-2 border-b border-white/5">
          <div className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
            <Phone className="w-3.5 h-3.5 text-amber-500" /> Phone numbers
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono font-bold">
            {text.trim() && (
              <>
                <span className="text-emerald-400">{analysis.valid.length} Valid</span>
                {analysis.invalid.length > 0 && (
                  <span className="text-red-400">· {analysis.invalid.length} Invalid</span>
                )}
              </>
            )}
            <span className="text-muted-foreground bg-black/40 px-2 py-0.5 rounded-lg border border-white/10">
              <span className={analysis.valid.length > 0 ? 'text-amber-400' : ''}>
                {analysis.valid.length}
              </span>{' '}
              Numbers
            </span>
          </div>
        </div>

        <div className="p-3 sm:p-5 space-y-2.5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> Smart Excel / File Upload
              </span>
              <button
                type="button"
                onClick={downloadSample}
                className="text-[10px] text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 hover:underline"
              >
                <Upload className="w-3 h-3" /> Sample Template (.xlsx)
              </button>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const file = e.dataTransfer.files?.[0]
                if (file) void handleFile(file)
              }}
              className={`relative border-2 border-dashed rounded-xl p-3 text-center transition-all cursor-pointer group ${
                dragOver
                  ? 'border-emerald-400 bg-emerald-500/10'
                  : 'border-white/10 bg-black/20 hover:border-emerald-500/50'
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="flex items-center justify-center gap-2 pointer-events-none">
                {parsing ? (
                  <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                ) : (
                  <CloudUpload className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                )}
                <div className="text-left">
                  <p className="text-xs font-bold">
                    {parsing ? 'Scanning & normalizing…' : 'Drop Excel (.xlsx, .xls) or CSV here'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Smart scanner extracts & formats Ghanaian MTN numbers
                  </p>
                </div>
              </div>
            </div>

            {extracted && (
              <div className="p-3 rounded-xl bg-black/40 border border-emerald-500/30 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs font-bold truncate">{extracted.fileName}</span>
                  </div>
                  <span className="text-emerald-400 border border-emerald-500/40 bg-emerald-500/10 text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0">
                    {extracted.validNumbers.length} Valid
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground grid grid-cols-2 gap-1 font-mono">
                  <div>
                    Total scanned:{' '}
                    <span className="text-foreground font-bold">{extracted.totalScanned}</span>
                  </div>
                  <div>
                    Invalid/skipped:{' '}
                    <span className="text-amber-400 font-bold">{extracted.invalidCount}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => applyExtracted('replace')}
                    className="h-7 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex-1"
                  >
                    Replace List
                  </button>
                  <button
                    type="button"
                    onClick={() => applyExtracted('append')}
                    className="h-7 text-[10px] font-bold border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 rounded-lg flex-1"
                  >
                    Append ({extracted.validNumbers.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtracted(null)}
                    className="h-7 text-[10px] text-muted-foreground px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={SAMPLE}
              className="w-full min-h-[90px] sm:min-h-[200px] max-h-[140px] sm:max-h-none font-mono text-xs sm:text-sm rounded-xl p-2.5 sm:p-4 resize-y border border-white/10 bg-black/40 outline-none focus:ring-1 focus:ring-amber-500/50 leading-relaxed"
            />
            {text && (
              <button
                type="button"
                title="Clear text"
                onClick={clearText}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 border border-white/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={!text.trim()}
              onClick={clearText}
              className="h-8 text-[11px] font-bold rounded-lg border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> Clear
            </button>
            <button
              type="button"
              disabled={!text.trim()}
              onClick={formatText}
              className="h-8 text-[11px] font-bold rounded-lg border border-white/10 text-muted-foreground hover:bg-white/5 disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <Sparkles className="w-3 h-3 text-amber-400" /> Format
            </button>
            <button
              type="button"
              onClick={() => setText(SAMPLE)}
              className="h-8 text-[11px] font-bold rounded-lg border border-white/10 text-amber-500 hover:bg-amber-500/10 inline-flex items-center justify-center gap-1"
            >
              <Copy className="w-3 h-3" /> Sample
            </button>
          </div>

          <p className="text-[10px] text-muted-foreground text-center sm:text-left">
            One per line or separated by commas/spaces. MTN only: {MTN_VERIFY_HINT}.
          </p>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {message && !summary && <p className="text-sm text-emerald-400">{message}</p>}

          <button
            type="button"
            disabled={busy || analysis.valid.length === 0}
            onClick={() => setConfirmOpen(true)}
            className="w-full h-11 sm:h-12 rounded-xl font-extrabold text-xs sm:text-sm shadow-lg inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98] bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white border border-blue-400/30 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Submitting…
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" /> Submit numbers for approval
              </>
            )}
          </button>
        </div>
      </div>

      {summary && (
        <div className="border border-white/10 shadow-xl rounded-2xl overflow-hidden bg-white/[0.03]">
          <div className="flex items-center justify-between p-3.5 sm:p-5 border-b border-white/5">
            <div className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-amber-500" /> Submission Results
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 font-bold rounded-full border ${
                summary.submitted > 0 || summary.verified > 0
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/15 text-red-400 border-red-500/30'
              }`}
            >
              {summary.submitted > 0 || summary.verified > 0
                ? `Submitted (${summary.submitted + summary.verified})`
                : 'Failed'}
            </span>
          </div>
          <div className="p-3.5 sm:p-5 space-y-3">
            <div className="p-3 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-xs font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="font-bold">{summary.message}</span>
            </div>
            {summary.numbers.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                  <span>Numbers ({summary.numbers.length})</span>
                  <button
                    type="button"
                    onClick={() => void copyList(summary.numbers)}
                    className="text-amber-500 hover:underline flex items-center gap-1 text-[11px]"
                  >
                    {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{' '}
                    Copy List
                  </button>
                </div>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-white/10 p-2 bg-black/30 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {summary.numbers.map((phone) => (
                    <div
                      key={phone}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-mono bg-white/5 border border-white/5"
                    >
                      <span>{phone}</span>
                      <span className="text-[9px] text-emerald-400 font-bold uppercase">
                        Submitted
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="border border-white/10 shadow-xl rounded-2xl overflow-hidden bg-white/[0.03]">
        <div className="px-3 sm:px-5 pt-3 pb-2 border-b border-white/5 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-amber-500" /> My Submitted Numbers
            </div>
            <button
              type="button"
              onClick={() => void refreshOpenStatuses()}
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
          <p className="text-[10px] sm:text-xs text-muted-foreground">
            Numbers you&apos;ve submitted for beneficiary approval, and their current status.
          </p>
        </div>

        <div className="p-3 sm:p-5 space-y-3">
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
                    Whitelisted
                  </p>
                  <p className="text-base font-black text-emerald-400">{counts.verified}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-blue-400">Pending</p>
                  <p className="text-base font-black text-blue-400">{counts.pending}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-red-400">Failed</p>
                  <p className="text-base font-black text-red-400">{counts.failed}</p>
                </div>
              </div>
            </>
          )}

          {filteredHistory.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              {history.length === 0
                ? 'No numbers submitted yet — your history will appear here.'
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
                      <Loader2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    )}
                    <span className="font-mono font-bold truncate">{row.phone}</span>
                    <span className="text-[9px] px-1.5 py-0 border border-amber-500/30 text-amber-400 bg-amber-500/10 rounded shrink-0">
                      MTN
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[9px] font-black uppercase tracking-wider ${statusTone(row.status)}`}
                    >
                      {statusLabel(row.status)}
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

      {confirmOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0c0c10] p-5 shadow-2xl space-y-3">
            <h2 className="text-base sm:text-xl font-extrabold">Submit for approval?</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You are about to submit <strong className="text-foreground">{analysis.valid.length}</strong>{' '}
              numbers for approval to be added to the beneficiary list.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
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
