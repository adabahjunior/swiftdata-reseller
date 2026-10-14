import { MessageSquare, Phone, PhoneCall, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { formatCurrency } from '../../lib/format'
import { formatMashupData, isMtnMashupNumber, MTN_MASHUP_PREFIXES, type MashupPackage } from '../../lib/mashup'
import { triggerOrderFulfillment } from '../../lib/providerFulfillment'
import { supabase } from '../../lib/supabase'

export default function MashupOrderPage() {
  const { user, refreshProfile } = useAuth()
  const [packages, setPackages] = useState<MashupPackage[]>([])
  const [availability, setAvailability] = useState<'loading' | 'open' | 'closed' | 'off'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
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

  const placeOrder = async () => {
    if (!user || !selected) return
    setSubmitting(true)
    setError(null)
    setMessage(null)

    const { data, error: rpcError } = await supabase.rpc('dashboard_place_mashup_order', {
      p_user_id: user.id,
      p_package_id: selected.id,
      p_phone: phone.replace(/\s/g, ''),
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

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="MTN MashUp"
        description="One 30-day MTN package with data, MTN-to-MTN minutes, other-network minutes and SMS. Paid from your wallet; also available through the API."
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

      <Panel title="1. Choose a package">
        <p className="text-xs text-muted-foreground mb-4">
          Packages are not in data order: some cheaper packages trade data for more voice minutes. Compare what is in
          each package, not just the price.
        </p>
        {availability === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading packages…</p>
        ) : packages.length === 0 ? (
          <EmptyState title="No MashUp packages yet" description="Packages appear here once MTN MashUp is switched on." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {packages.map((p) => {
              const active = p.id === selectedId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`text-left rounded-xl border p-4 transition ${
                    active ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/[0.02] hover:border-white/25'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold">{p.title}</span>
                    <span className="font-black text-lg text-primary">{formatCurrency(p.price)}</span>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Wifi className="h-3.5 w-3.5" /> {formatMashupData(p.mb)} data
                    </li>
                    <li className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5" /> {p.onnet_mins} min MTN to MTN
                    </li>
                    <li className="flex items-center gap-2">
                      <PhoneCall className="h-3.5 w-3.5" /> {p.offnet_mins} min to other networks
                    </li>
                    <li className="flex items-center gap-2">
                      <MessageSquare className="h-3.5 w-3.5" /> {p.sms} SMS
                    </li>
                  </ul>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Valid {p.validity_days} days · code <span className="font-mono">{p.code}</span>
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </Panel>

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
    </div>
  )
}
