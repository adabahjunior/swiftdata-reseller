import { Phone, Tv, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Panel } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { formatCurrency } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import {
  UTILITY_SERVICES,
  chargeForUtility,
  type UtilityProduct,
  type UtilityServiceId,
} from '../../lib/utilityConstants'
import { triggerXcelOrderFulfillment } from '../../lib/xcelFulfillment'

const ICONS = { airtime: Phone, ecg: Zap, tv: Tv } as const

export default function UtilitiesOrderPage() {
  const { user, refreshProfile } = useAuth()
  const [service, setService] = useState<UtilityServiceId>('airtime')
  const [products, setProducts] = useState<UtilityProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [providerCode, setProviderCode] = useState('')
  const [beneficiary, setBeneficiary] = useState('')
  const [accountName, setAccountName] = useState('')
  const [faceAmount, setFaceAmount] = useState<number | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('utility_products')
        .select('*')
        .eq('active', true)
        .order('display_order')
      if (!cancelled) {
        setProducts((data as UtilityProduct[]) ?? [])
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const serviceProducts = useMemo(
    () => products.filter((p) => p.service_type === service),
    [products, service],
  )

  useEffect(() => {
    if (serviceProducts.length === 0) {
      setProviderCode('')
      return
    }
    if (!serviceProducts.some((p) => p.provider_code === providerCode)) {
      setProviderCode(serviceProducts[0].provider_code)
    }
  }, [serviceProducts, providerCode])

  const selected = serviceProducts.find((p) => p.provider_code === providerCode)
  const charge = selected && faceAmount !== ''
    ? chargeForUtility(Number(faceAmount), selected)
    : 0

  const placeOrder = async () => {
    if (!user || !selected || faceAmount === '') return
    setSubmitting(true)
    setError(null)
    setMessage(null)

    const { data, error: rpcError } = await supabase.rpc('dashboard_place_utility_order', {
      p_user_id: user.id,
      p_service_type: service,
      p_provider_code: selected.provider_code,
      p_beneficiary: beneficiary.trim(),
      p_face_amount: Number(faceAmount),
      p_account_name: accountName.trim() || null,
      p_extra: {},
    })

    setSubmitting(false)

    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? data?.error ?? 'Order failed')
      await refreshProfile()
      return
    }

    setMessage(`Order placed — ${data.order.reference} (${data.order.status})`)
    setBeneficiary('')
    setAccountName('')
    setFaceAmount('')
    if (data.order?.id) void triggerXcelOrderFulfillment(data.order.id)
    await refreshProfile()
  }

  const serviceMeta = UTILITY_SERVICES.find((s) => s.id === service)!

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Utilities"
        description="Buy airtime, pay ECG, or renew TV subscriptions from your wallet. Also available via API."
      />

      <div className="flex flex-wrap gap-2 p-1 rounded-xl border border-white/10 bg-white/[0.02] w-fit">
        {UTILITY_SERVICES.map((s) => {
          const Icon = ICONS[s.id]
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setService(s.id)}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm transition ${
                service === s.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {s.label}
            </button>
          )
        })}
      </div>

      <Panel title="Place order">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading products…</p>
        ) : serviceProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active {serviceMeta.label} products. Ask an admin to enable Xcel utilities.
          </p>
        ) : (
          <div className="grid gap-4 max-w-xl">
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Provider</span>
              <select
                value={providerCode}
                onChange={(e) => setProviderCode(e.target.value)}
                className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 outline-none"
              >
                {serviceProducts.map((p) => (
                  <option key={p.id} value={p.provider_code}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">{serviceMeta.beneficiaryLabel}</span>
              <input
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                placeholder={serviceMeta.beneficiaryHint}
                className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 outline-none"
              />
            </label>

            {(service === 'ecg' || service === 'tv') && (
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground">Account / customer name (optional)</span>
                <input
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 outline-none"
                />
              </label>
            )}

            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Amount (GHS)</span>
              <input
                type="number"
                min={selected?.min_amount ?? 1}
                max={selected?.max_amount ?? 5000}
                step="0.01"
                value={faceAmount}
                onChange={(e) =>
                  setFaceAmount(e.target.value === '' ? '' : Number(e.target.value))
                }
                className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 outline-none"
              />
              {selected && (
                <p className="text-[11px] text-muted-foreground">
                  Range {formatCurrency(selected.min_amount)} – {formatCurrency(selected.max_amount)}
                  {selected.markup_percent > 0 || selected.flat_fee > 0
                    ? ` · You pay ${formatCurrency(charge)} (includes markup/fees)`
                    : ` · You pay ${formatCurrency(charge)}`}
                </p>
              )}
            </label>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {message && (
              <p className="text-sm text-emerald-400">
                {message}{' '}
                <Link to="/dashboard/orders" className="underline">
                  View orders
                </Link>
              </p>
            )}

            <button
              type="button"
              disabled={submitting || !selected || !beneficiary || !faceAmount}
              onClick={() => void placeOrder()}
              className="h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Placing…' : `Pay ${formatCurrency(charge || 0)}`}
            </button>
          </div>
        )}
      </Panel>
    </div>
  )
}
