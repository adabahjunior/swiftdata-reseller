import {
  CloudUpload,
  FileSpreadsheet,
  Loader2,
  Phone,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { MTN_VERIFY_HINT } from './NumberVerificationSubmitForm'
import {
  analyzeVerifyText,
  downloadVerifySampleXlsx,
  parseVerifyFile,
  parseVerifyPhones,
  type ExtractedFile,
} from '../lib/verifyPhoneInput'

const SAMPLE = '0538122730\n0241234567\n0554226398'

export type VerifyInputMode = 'single' | 'bulk' | 'file'

type Props = {
  mode: VerifyInputMode
  onModeChange: (mode: VerifyInputMode) => void
  singlePhone: string
  onSinglePhoneChange: (value: string) => void
  bulkText: string
  onBulkTextChange: (value: string) => void
  disabled?: boolean
}

export function NumberVerificationInput({
  mode,
  onModeChange,
  singlePhone,
  onSinglePhoneChange,
  bulkText,
  onBulkTextChange,
  disabled = false,
}: Props) {
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const bulkAnalysis = analyzeVerifyText(bulkText)
  const singleValid = /^0(24|25|53|54|55|59)\d{7}$/.test(singlePhone.trim())

  const handleFile = async (file: File) => {
    setParsing(true)
    setFileError(null)
    try {
      const result = await parseVerifyFile(file)
      if (result.validNumbers.length === 0) {
        setFileError(
          `Scanned ${result.totalScanned} cells in ${result.fileName}, but found no valid MTN numbers (${MTN_VERIFY_HINT}).`,
        )
        setExtracted(null)
        return
      }
      setExtracted(result)
    } catch (e) {
      setFileError((e as Error).message || 'Failed to parse file')
      setExtracted(null)
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const applyExtracted = (applyMode: 'replace' | 'append') => {
    if (!extracted) return
    onModeChange('bulk')
    const current = parseVerifyPhones(bulkText)
    const next =
      applyMode === 'replace'
        ? extracted.validNumbers
        : [...new Set([...current, ...extracted.validNumbers])]
    onBulkTextChange(next.join('\n'))
    setExtracted(null)
  }

  const clearBulk = () => {
    onBulkTextChange('')
    setExtracted(null)
    setFileError(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['single', 'Single'],
            ['bulk', 'Bulk'],
            ['file', 'Excel / File'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onModeChange(id)}
            className={`h-9 rounded-lg border px-3 text-xs sm:text-sm font-bold transition-colors ${
              mode === id
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-white/10 bg-black/30 text-muted-foreground hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'single' && (
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
            <Phone className="w-3.5 h-3.5 text-amber-400" /> MTN phone number
          </label>
          <input
            value={singlePhone}
            onChange={(e) => onSinglePhoneChange(e.target.value)}
            disabled={disabled}
            placeholder="0241234567"
            className="w-full h-11 rounded-xl border border-white/10 bg-black/40 px-4 text-sm font-mono outline-none focus:ring-1 focus:ring-amber-500/50"
          />
          {singlePhone.trim() && (
            <p className={`text-[11px] font-bold ${singleValid ? 'text-emerald-400' : 'text-red-400'}`}>
              {singleValid ? 'Valid MTN number' : `Invalid — use ${MTN_VERIFY_HINT}`}
            </p>
          )}
        </div>
      )}

      {mode === 'bulk' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-muted-foreground">Paste numbers</span>
            {bulkText.trim() && (
              <span className="text-[10px] font-mono font-bold">
                <span className="text-emerald-400">{bulkAnalysis.valid.length} valid</span>
                {bulkAnalysis.invalid.length > 0 && (
                  <span className="text-red-400"> · {bulkAnalysis.invalid.length} invalid</span>
                )}
              </span>
            )}
          </div>
          <div className="relative">
            <textarea
              value={bulkText}
              onChange={(e) => onBulkTextChange(e.target.value)}
              disabled={disabled}
              placeholder={SAMPLE}
              className="w-full min-h-[120px] sm:min-h-[160px] font-mono text-xs sm:text-sm rounded-xl p-3 resize-y border border-white/10 bg-black/40 outline-none focus:ring-1 focus:ring-amber-500/50"
            />
            {bulkText && (
              <button
                type="button"
                title="Clear"
                disabled={disabled}
                onClick={clearBulk}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 border border-white/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            One per line or comma-separated. MTN only: {MTN_VERIFY_HINT}.
          </p>
        </div>
      )}

      {mode === 'file' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> Upload spreadsheet
            </span>
            <button
              type="button"
              onClick={downloadVerifySampleXlsx}
              className="text-[10px] text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 hover:underline"
            >
              <Upload className="w-3 h-3" /> Sample (.xlsx)
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
              if (file && !disabled) void handleFile(file)
            }}
            className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer group ${
              dragOver
                ? 'border-emerald-400 bg-emerald-500/10'
                : 'border-white/10 bg-black/20 hover:border-emerald-500/50'
            } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              disabled={disabled}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pointer-events-none">
              {parsing ? (
                <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
              ) : (
                <CloudUpload className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform" />
              )}
              <div>
                <p className="text-xs font-bold">
                  {parsing ? 'Scanning file…' : 'Drop Excel (.xlsx, .xls) or CSV here'}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Numbers are extracted from every cell automatically
                </p>
              </div>
            </div>
          </div>

          {fileError && <p className="text-sm text-red-400">{fileError}</p>}

          {extracted && (
            <div className="p-3 rounded-xl bg-black/40 border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-xs font-bold truncate">{extracted.fileName}</span>
                </div>
                <span className="text-emerald-400 border border-emerald-500/40 bg-emerald-500/10 text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0">
                  {extracted.validNumbers.length} valid
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground grid grid-cols-2 gap-1 font-mono">
                <div>
                  Scanned: <span className="text-foreground font-bold">{extracted.totalScanned}</span>
                </div>
                <div>
                  Skipped: <span className="text-amber-400 font-bold">{extracted.invalidCount}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => applyExtracted('replace')}
                  className="h-8 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex-1"
                >
                  Load into bulk
                </button>
                <button
                  type="button"
                  onClick={() => applyExtracted('append')}
                  className="h-8 text-[10px] font-bold border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 rounded-lg flex-1"
                >
                  Append to bulk
                </button>
                <button
                  type="button"
                  onClick={() => setExtracted(null)}
                  className="h-8 text-[10px] text-muted-foreground px-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            After upload, load numbers into bulk view to check or submit them.
          </p>
        </div>
      )}
    </div>
  )
}

/** Collect valid phones from current input state. */
export function collectVerifyPhones(
  mode: VerifyInputMode,
  singlePhone: string,
  bulkText: string,
): string[] {
  if (mode === 'single') {
    const phone = singlePhone.trim()
    return phone ? [phone] : []
  }
  return analyzeVerifyText(bulkText).valid
}
