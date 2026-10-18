import { Check, Layers, MessageSquare, Phone, PhoneCall, Send, Wifi } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { formatCurrency } from '../../lib/format'
import {
  formatMashupData,
  isMtnMashupNumber,
  MTN_MASHUP_PREFIXES,
  normalizeMashupPhone,
  type MashupPackage,
} from '../../lib/mashup'
import { triggerOrderFulfillment, triggerProviderFulfillment } from '../../lib/providerFulfillment'
import { supabase } from '../../lib/supabase'

function MashupPackageCard({
  pkg,
  active,
  index,
  onSelect,
}: {
  pkg: MashupPackage
  active: boolean
  index: number
  onSelect: () => void
}) {
  const dataLabel = formatMashupData(pkg.mb)
  const [dataValue, dataUnit] = (() => {
    const parts = dataLabel.split(' ')
    return [parts[0], parts.slice(1).join(' ') || 'MB'] as const
  })()

  const stats = [
    { icon: Phone, value: pkg.onnet_mins, label: 'MTN mins' },
    { icon: PhoneCall, value: pkg.offnet_mins, label: 'Other mins' },
    { icon: MessageSquare, value: pkg.sms, label: 'SMS' },
  ] as const

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      style={{ animationDelay: `${Math.min(index, 11) * 40}ms` }}
      className={`group relative animate-fade-in-up text-left overflow-hidden rounded-2xl border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
        active
          ? 'border-primary/60 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent shadow-[0_0_0_1px_hsl(51_100%_50%/0.25),0_12px_40px_-12px_hsl(51_100%_50%/0.35)]'
          : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.05]'
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent transition-opacity ${
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
        }`}
      />
      <div
        className={`pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/20 blur-2xl transition-opacity ${
          active ? 'opacity-70' : 'opacity-0 group-hover:opacity-40'
        }`}
      />

      <div className="relative p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {pkg.validity_days}-day mashup
            </p>
            <div className="mt-1.5 flex items-end gap-1.5">
              <span className="font-display text-3xl font-bold leading-none tracking-tight tabular-nums">
                {dataValue}
              </span>
              <span className="pb-0.5 text-sm font-semibold text-muted-foreground">{dataUnit}</span>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wifi className="h-3.5 w-3.5 shrink-0 text-primary/80" />
              <span className="truncate">{pkg.title}</span>
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="font-display text-xl font-bold tabular-nums text-primary leading-none">
              {formatCurrency(pkg.price)}
            </p>
            <div
              className={`mt-2 ml-auto flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-white/15 bg-transparent text-transparent group-hover:border-white/30'
              }`}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
          {stats.map(({ icon: Icon, value, label }) => (
            <div key={label} className="min-w-0">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Icon className="h-3 w-3 shrink-0" />
                <span className="truncate text-[10px] uppercase tracking-wide">{label}</span>
              </div>
              <p className="mt-0.5 font-display text-base font-semibold tabular-nums leading-tight">{value}</p>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Code <span className="font-mono text-foreground/80">{pkg.code}</span>
        </p>
      </div>
    </button>
  )
}

type Tab = 'single' | 'bulk'

const MAX_BULK = 100

type BulkLine = {
  line: number
  phone: string
  pkg: MashupPackage | null
  repeat?: boolean
  error?: string
}

type BulkResult = {
  succeeded: number
  failed: number
  spent: number
  failures: { phone: string; error: string }[]
}

function parseBulkLines(text: string, packages: MashupPackage[], fallback: MashupPackage | null): BulkLine[] {
  const seen = new Set<string>()
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw, index) => {
      const parts = raw.split(/[,;\t]+/).map((p) => p.trim()).filter(Boolean)
      const phone = normalizeMashupPhone(parts[0] ?? '')
      const code = parts[1]?.toUpperCase()
      const pkg = code ? packages.find((p) => p.code.toUpperCase() === code) ?? null : fallback
      const row: BulkLine = { line: index + 1, phone, pkg }

      if (!isMtnMashupNumber(phone)) row.error = 'Not a valid MTN number'
      else if (code && !pkg) row.error = `Unknown package code ${code}`
      else if (!pkg) row.error = 'Choose a package above or add a code'

      if (!row.error && pkg) {
        const key = `${phone}|${pkg.id}`
        row.repeat = seen.has(key)
        seen.add(key)
      }
      return row
    })
}

export default function MashupOrderPage() {
  const { user, refreshProfile } = useAuth()
  const [tab, setTab] = useState<Tab>('single')
  const [packages, setPackages] = useState<MashupPackage[]>([])
  const [availability, setAvailability] = useState<'loading' | 'open' | 'closed' | 'off'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [{ data: pkgs }, { data: flags }] = await Promise.all([
        supabase.rpc('get_mashup_packages'),
        supabase.from('site_settings').select('key, value').in('key', ['mashup_enabled', 'mashup_lane_open']),
      ])
      if (cancelled) return
      const flag = Object.fromEntries((flags ?? []).map((f) => [f.key, f.value]))
      setPackages(((pkgs as MashupPackage[]) ?? []).map((p) => ({ ...p, price: Number(p.price), capacity: Number(p.capacity) })))
      setAvailability(flag.mashup_enabled !== 'true' ? 'off' : flag.mashup_lane_open === 'false' ? 'closed' : 'open')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selected = packages.find((p) => p.id === selectedId) ?? null
  const phoneValid = isMtnMashupNumber(phone)
  const balance = Number(user?.wallet_balance ?? 0)
  const canBuy = availability === 'open' && selected && phoneValid && !submitting

  const parsedBulk = useMemo(() => parseBulkLines(bulkText, packages, selected), [bulkText, packages, selected])
  const validBulk = parsedBulk.filter((r) => !r.error)
  const bulkTotal = validBulk.reduce((sum, r) => sum + (r.pkg?.price ?? 0), 0)
  const repeats = validBulk.filter((r) => r.repeat).length
  const canBuyBulk =
    availability === 'open' && validBulk.length > 0 && validBulk.length <= MAX_BULK && !submitting

  const switchTab = (next: Tab) => {
    setTab(next)
    setError(null)
    setMessage(null)
    setBulkResult(null)
  }

  const placeOrder = async () => {
    if (!user || !selected) return
    setSubmitting(true)
    setError(null)
    setMessage(null)

    const { data, error: rpcError } = await supabase.rpc('dashboard_place_mashup_order', {
      p_user_id: user.id,
      p_package_id: selected.id,
      p_phone: normalizeMashupPhone(phone),
    })

    setSubmitting(false)
    await refreshProfile()

    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? data?.error ?? 'Order failed')
      return
    }

    setMessage(`${selected.title} ordered for ${data.order.phone} — ${data.order.reference}`)
    setPhone('')
    void triggerOrderFulfillment(data.order.id)
  }

  const placeBulk = async () => {
    if (!user || validBulk.length === 0) return
    setSubmitting(true)
    setError(null)
    setMessage(null)
    setBulkResult(null)

    const { data, error: rpcError } = await supabase.rpc('dashboard_place_bulk_mashup_orders', {
      p_user_id: user.id,
      p_orders: validBulk.map((r) => ({ phone: r.phone, package_id: r.pkg!.id, package_code: r.pkg!.code })),
    })

    setSubmitting(false)
    await refreshProfile()

    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? data?.error ?? 'Bulk order failed')
      return
    }

    const results = (data.results ?? []) as { success: boolean; error?: string; phone: string }[]
    setBulkResult({
      succeeded: Number(data.succeeded ?? 0),
      failed: Number(data.failed ?? 0),
      spent: Number(data.spent ?? 0),
      failures: results.filter((r) => !r.success).map((r) => ({ phone: r.phone, error: r.error ?? 'Failed' })),
    })
    if (Number(data.failed ?? 0) === 0) setBulkText('')
    if (Number(data.succeeded ?? 0) > 0) triggerProviderFulfillment()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="MTN MashUp"
        description="One 30-day MTN package with data, MTN-to-MTN minutes, other-network minutes and SMS. Buy for one number or many at once; paid from your wallet and also available through the API."
      />

      {availability === 'off' && (
        <p className="text-sm rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 px-4 py-3">
          MTN MashUp is not available yet. Check back soon.
        </p>
      )}
      {availability === 'closed' && (
        <p className="text-sm rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 px-4 py-3">
          MTN MashUp is temporarily unavailable. You can browse packages, but orders are paused for now.
        </p>
      )}

      <div className="flex gap-2 p-1 rounded-xl border border-white/10 bg-white/[0.02] w-fit">
        {([
          ['single', 'Single Order', Send],
          ['bulk', 'Bulk Orders', Layers],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => switchTab(id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <Panel title={tab === 'single' ? '1. Choose a package' : '1. Default package (optional)'}>
        <p className="text-xs text-muted-foreground mb-4">
          {tab === 'bulk' &&
            'Lines without a package code use the package you select here. Click the selected package again to clear it. '}
          Packages are not in data order: some cheaper packages trade data for more voice minutes. Compare what is in
          each package, not just the price.
        </p>
        {availability === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading packages…</p>
        ) : packages.length === 0 ? (
          <EmptyState title="No MashUp packages yet" description="Packages appear here once MTN MashUp is switched on." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {packages.map((p, index) => {
              const active = p.id === selectedId
              return (
                <MashupPackageCard
                  key={p.id}
                  pkg={p}
                  active={active}
                  index={index}
                  onSelect={() => setSelectedId(active && tab === 'bulk' ? null : p.id)}
                />
              )
            })}
          </div>
        )}
      </Panel>

      {tab === 'single' ? (
        <Panel title="2. Recipient">
          <div className="grid gap-4 max-w-xl">
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">MTN number</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0241234567"
                inputMode="numeric"
                className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 outline-none"
              />
              <span className="text-[11px] text-muted-foreground">
                MTN only: {MTN_MASHUP_PREFIXES.join(', ')}
              </span>
            </label>

            {phone && !phoneValid && <p className="text-sm text-red-400">Enter a valid 10-digit MTN number.</p>}
            {selected && selected.price > balance && (
              <p className="text-sm text-amber-400">
                Your balance ({formatCurrency(balance)}) is below this package price.{' '}
                <Link to="/dashboard/balance" className="underline">
                  Top up
                </Link>
              </p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {message && (
              <p className="text-sm text-emerald-400">
                {message}.{' '}
                <Link to="/dashboard/orders" className="underline">
                  Track it in orders
                </Link>
              </p>
            )}

            <button
              type="button"
              disabled={!canBuy}
              onClick={() => void placeOrder()}
              className="h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Placing…' : selected ? `Pay ${formatCurrency(selected.price)}` : 'Choose a package'}
            </button>
            <p className="text-[11px] text-muted-foreground">
              Delivery is usually instant. If MTN can't deliver, your wallet is refunded automatically. Selling from your
              own app? See <Link to="/dashboard/docs" className="underline">the API docs</Link> (MTN MashUp section).
            </p>
          </div>
        </Panel>
      ) : (
        <Panel
          title="2. Recipients"
          description={`One MTN number per line, up to ${MAX_BULK}. Add ",CODE" after a number to give it a different package. Balance: ${formatCurrency(balance)}`}
        >
          <div className="space-y-4 max-w-3xl">
            <textarea
              value={bulkText}
              onChange={(e) => {
                setBulkText(e.target.value)
                setBulkResult(null)
              }}
              rows={10}
              placeholder={`0241234567\n0551234567\n0541234567,${packages[0]?.code ?? 'MASHUP10'}`}
              className="w-full rounded-xl border border-white/10 bg-secondary/50 px-4 py-3 text-sm font-mono outline-none resize-y"
            />
            <p className="text-[11px] text-muted-foreground">
              MTN only: {MTN_MASHUP_PREFIXES.join(', ')}. Numbers starting 233 or +233 are accepted.
            </p>

            {parsedBulk.length > 0 && (
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <div className="px-4 py-2 bg-white/[0.03] text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
                  <span>
                    {validBulk.length} valid · {parsedBulk.length - validBulk.length} invalid
                    {repeats > 0 && ` · ${repeats} repeated`}
                  </span>
                  <span>Total: {formatCurrency(bulkTotal)}</span>
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-white/10 text-xs">
                  {parsedBulk.slice(0, 50).map((row) => (
                    <div key={row.line} className="px-4 py-2 flex justify-between gap-2">
                      <span className="font-mono">
                        L{row.line}: {row.phone || '—'} · {row.pkg?.title ?? '—'}
                        {row.pkg && ` · ${formatCurrency(row.pkg.price)}`}
                      </span>
                      {row.error ? (
                        <span className="text-red-400">{row.error}</span>
                      ) : row.repeat ? (
                        <span className="text-amber-400">Repeat — will be bought again</span>
                      ) : (
                        <span className="text-emerald-400">OK</span>
                      )}
                    </div>
                  ))}
                  {parsedBulk.length > 50 && (
                    <p className="px-4 py-2 text-muted-foreground">…and {parsedBulk.length - 50} more</p>
                  )}
                </div>
              </div>
            )}

            {validBulk.length > MAX_BULK && (
              <p className="text-sm text-red-400">
                Maximum {MAX_BULK} orders per submit. Split the list into smaller batches.
              </p>
            )}
            {validBulk.length > 0 && bulkTotal > balance && (
              <p className="text-sm text-amber-400">
                Total ({formatCurrency(bulkTotal)}) is above your balance ({formatCurrency(balance)}). Orders are placed
                top to bottom and the ones your balance can't cover will fail.{' '}
                <Link to="/dashboard/balance" className="underline">
                  Top up
                </Link>
              </p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {bulkResult && (
              <div
                className={`text-sm rounded-lg border px-4 py-3 space-y-2 ${
                  bulkResult.failed === 0
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                }`}
              >
                <p>
                  {bulkResult.succeeded} placed ({formatCurrency(bulkResult.spent)}), {bulkResult.failed} failed.{' '}
                  {bulkResult.succeeded > 0 && (
                    <Link to="/dashboard/orders" className="underline">
                      Track them in orders
                    </Link>
                  )}
                </p>
                {bulkResult.failures.length > 0 && (
                  <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                    {bulkResult.failures.map((f, i) => (
                      <li key={`${f.phone}-${i}`} className="font-mono">
                        {f.phone}: {f.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={!canBuyBulk}
              onClick={() => void placeBulk()}
              className="h-11 px-6 rounded-lg bg-primary text-primary-foreground font-black disabled:opacity-50"
            >
              {submitting
                ? 'Submitting…'
                : `Submit ${validBulk.length} order(s)${validBulk.length ? ` — ${formatCurrency(bulkTotal)}` : ''}`}
            </button>
            <p className="text-[11px] text-muted-foreground">
              Each number becomes its own order. If MTN can't deliver one, that order alone is refunded to your wallet.
            </p>
          </div>
        </Panel>
      )}
    </div>
  )
}
