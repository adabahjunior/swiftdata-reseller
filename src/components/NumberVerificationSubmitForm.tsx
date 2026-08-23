import { Loader2, Send, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

export const MTN_VERIFY_PREFIXES = ['024', '025', '053', '054', '055', '059'] as const
export const MTN_VERIFY_HINT = '024, 025, 053, 054, 055, 059'

export function normalizeVerifyPhone(raw: string): string {
  let phone = raw.trim().replace(/[\s\-()]/g, '')
  if (phone.startsWith('+233')) phone = `0${phone.slice(4)}`
  else if (phone.startsWith('233') && phone.length >= 12) phone = `0${phone.slice(3)}`
  else if (/^[2-5]\d{8}$/.test(phone)) phone = `0${phone}`
  return phone
}

export function parseVerifyPhones(text: string): string[] {
  const parts = text.split(/[\n,;]+/).map((p) => normalizeVerifyPhone(p)).filter(Boolean)
  return [...new Set(parts)]
}

export function isAllowedMtnVerifyPhone(phone: string) {
  return /^0(24|25|53|54|55|59)\d{7}$/.test(phone)
}

type Props = {
  busy?: boolean
  onSubmit: (phones: string[]) => Promise<void> | void
  onCheckOnly?: (phones: string[]) => Promise<void> | void
  maxBulk?: number
  submitLabel?: string
}

export function NumberVerificationSubmitForm({
  busy = false,
  onSubmit,
  onCheckOnly,
  maxBulk = 100,
  submitLabel = 'Submit',
}: Props) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [singlePhone, setSinglePhone] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const collectPhones = () => {
    const phones =
      mode === 'single'
        ? [normalizeVerifyPhone(singlePhone)].filter(Boolean)
        : parseVerifyPhones(bulkInput)

    if (phones.length === 0) {
      setLocalError(`Enter at least one MTN number (${MTN_VERIFY_HINT})`)
      return null
    }
    if (phones.length > maxBulk) {
      setLocalError(`Maximum ${maxBulk} numbers per bulk submit`)
      return null
    }

    const invalid = phones.filter((p) => !isAllowedMtnVerifyPhone(p))
    if (invalid.length > 0) {
      setLocalError(
        `Only MTN numbers starting with ${MTN_VERIFY_HINT} are allowed. Invalid: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}`,
      )
      return null
    }

    setLocalError(null)
    return phones
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
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
          placeholder={'0241234567\n0538122730\n0549876543\n0551112233'}
          className="w-full rounded-xl border border-white/10 bg-secondary/50 px-4 py-3 text-sm font-mono outline-none resize-y"
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const phones = collectPhones()
            if (phones) void onSubmit(phones)
          }}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? 'Submitting…' : mode === 'bulk' ? 'Bulk submit' : submitLabel}
        </button>
        {onCheckOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const phones = collectPhones()
              if (phones) void onCheckOnly(phones)
            }}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg border border-white/10 bg-secondary/50 text-sm font-bold disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Check status
          </button>
        )}
      </div>

      {localError && <p className="text-sm text-red-400">{localError}</p>}
    </div>
  )
}
