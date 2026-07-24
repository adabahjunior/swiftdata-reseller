import { Layers, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Panel } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { usePackages } from '../../hooks/useDashboardData'
import { PACKAGE_NETWORKS, apiNetworkToDb } from '../../lib/constants'
import { formatCurrency } from '../../lib/format'
import { triggerOrderFulfillment, triggerProviderFulfillment } from '../../lib/providerFulfillment'
import { supabase } from '../../lib/supabase'

type Tab = 'single' | 'bulk'

type ParsedLine = {
  line: number
  phone: string
  network: string
  size_gb: number
  error?: string
}

function parseBulkLines(text: string): ParsedLine[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.map((line, index) => {
    const parts = line.split(/[,\t]+/).map((p) => p.trim())
    if (parts.length < 3) {
      return { line: index + 1, phone: '', network: '', size_gb: 0, error: 'Use format: phone,network,size_gb' }
    }
    const [phone, networkRaw, sizeRaw] = parts
    const network = apiNetworkToDb(networkRaw.toLowerCase())
    const size_gb = Number(sizeRaw)
    if (!/^0[2-5]\d{8}$/.test(phone)) {
      return { line: index + 1, phone, network, size_gb, error: 'Invalid phone' }
    }
    if (!PACKAGE_NETWORKS.some((n) => n.id === network)) {
      return { line: index + 1, phone, network, size_gb, error: 'Invalid network' }
    }
    if (!size_gb || size_gb <= 0) {
      return { line: index + 1, phone, network, size_gb, error: 'Invalid size_gb' }
    }
    return { line: index + 1, phone, network, size_gb }
  })
}

export default function PlaceOrderPage() {
  const { user, refreshProfile } = useAuth()
  const { packages, loading: packagesLoading } = usePackages()
  const [tab, setTab] = useState<Tab>('single')

  const [phone, setPhone] = useState('')
  const [network, setNetwork] = useState('mtn')
  const [sizeGb, setSizeGb] = useState<number | ''>('')
  const [bulkText, setBulkText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const networkPackages = useMemo(
    () => packages.filter((p) => p.network === network).sort((a, b) => a.size_gb - b.size_gb),
    [packages, network],
  )

  const selectedPackage = useMemo(
    () => networkPackages.find((p) => p.size_gb === Number(sizeGb)),
    [networkPackages, sizeGb],
  )

  const parsedBulk = useMemo(() => parseBulkLines(bulkText), [bulkText])
  const validBulk = parsedBulk.filter((r) => !r.error)
  const bulkTotal = useMemo(() => {
    return validBulk.reduce((sum, row) => {
      const pkg = packages.find((p) => p.network === row.network && p.size_gb === row.size_gb)
      return sum + Number(pkg?.price ?? 0)
    }, 0)
  }, [validBulk, packages])

  const placeSingle = async () => {
    if (!user || !selectedPackage) return
    if (!/^0[2-5]\d{8}$/.test(phone.trim())) {
      setError('Enter a valid Ghana phone number e.g. 0241234567')
      return
    }

    setSubmitting(true)
    setError(null)
    setMessage(null)

    const { data, error: rpcError } = await supabase.rpc('dashboard_place_order', {
      p_user_id: user.id,
      p_network: network,
      p_size_gb: selectedPackage.size_gb,
      p_phone: phone.trim(),
    })

    setSubmitting(false)

    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? data?.error ?? 'Order failed')
      await refreshProfile()
      return
    }

    setMessage(`Order placed — ${data.order.reference} (${data.order.status})`)
    setPhone('')
    // Single-order path only — avoid also calling /process (duplicate provider purchases)
    if (data.order?.id) void triggerOrderFulfillment(data.order.id)
    await refreshProfile()
  }

  const placeBulk = async () => {
    if (!user || validBulk.length === 0) return

    setSubmitting(true)
    setError(null)
    setMessage(null)

    const payload = validBulk.map((r) => ({
      phone: r.phone,
      network: r.network,
      size_gb: r.size_gb,
    }))

    const { data, error: rpcError } = await supabase.rpc('dashboard_place_bulk_orders', {
      p_user_id: user.id,
      p_orders: payload,
    })

    setSubmitting(false)

    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? data?.error ?? 'Bulk order failed')
      await refreshProfile()
      return
    }

    setMessage(
      `Bulk complete — ${data.succeeded} succeeded, ${data.failed} failed. Successful orders are on the admin dashboard.`,
    )
    if (data.failed === 0) setBulkText('')
    triggerProviderFulfillment()
    await refreshProfile()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Place Order"
        description="Submit single or bulk data orders from your dashboard. Orders appear on the admin panel for fulfillment."
      />

      <div className="flex gap-2 p-1 rounded-xl border border-white/10 bg-white/[0.02] w-fit">
        {([
          ['single', 'Single Order', Send],
          ['bulk', 'Bulk Orders', Layers],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
          {error}
          {error.includes('balance') && (
            <>
              {' '}
              <Link to="/dashboard/balance" className="underline font-bold">
                Top up balance
              </Link>
            </>
          )}
        </p>
      )}
      {message && (
        <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2">
          {message}
        </p>
      )}

      {tab === 'single' ? (
        <Panel title="Single Order" description={`Balance: ${formatCurrency(user?.wallet_balance ?? 0)}`}>
          {packagesLoading ? (
            <p className="text-sm text-muted-foreground">Loading packages…</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4 max-w-xl">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0241234567"
                  className="mt-1 w-full h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Network</label>
                <select
                  value={network}
                  onChange={(e) => {
                    setNetwork(e.target.value)
                    setSizeGb('')
                  }}
                  className="mt-1 w-full h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
                >
                  {PACKAGE_NETWORKS.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Package size</label>
                <select
                  value={sizeGb}
                  onChange={(e) => setSizeGb(e.target.value ? Number(e.target.value) : '')}
                  className="mt-1 w-full h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
                >
                  <option value="">Select size</option>
                  {networkPackages.map((p) => (
                    <option key={p.id} value={p.size_gb}>
                      {p.size_gb} GB — {formatCurrency(Number(p.price))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={submitting || !selectedPackage}
                  onClick={() => void placeSingle()}
                  className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-black disabled:opacity-50"
                >
                  {submitting ? 'Placing…' : `Place order${selectedPackage ? ` (${formatCurrency(Number(selectedPackage.price))})` : ''}`}
                </button>
              </div>
            </div>
          )}
        </Panel>
      ) : (
        <Panel
          title="Bulk Orders"
          description="One order per line: phone,network,size_gb — max 100 lines. Networks: mtn, at_ishare, at_bigtime, telecel (yello = mtn)"
        >
          <div className="space-y-4 max-w-3xl">
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={10}
              placeholder={`0241234567,mtn,1\n0271234567,at_ishare,2\n0201234567,telecel,5`}
              className="w-full rounded-xl border border-white/10 bg-secondary/50 px-4 py-3 text-sm font-mono outline-none resize-y"
            />

            {parsedBulk.length > 0 && (
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <div className="px-4 py-2 bg-white/[0.03] text-xs text-muted-foreground flex justify-between">
                  <span>{validBulk.length} valid · {parsedBulk.length - validBulk.length} invalid</span>
                  <span>Est. total: {formatCurrency(bulkTotal)}</span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-white/10 text-xs">
                  {parsedBulk.slice(0, 20).map((row) => (
                    <div key={row.line} className="px-4 py-2 flex justify-between gap-2">
                      <span className="font-mono">
                        L{row.line}: {row.phone || '—'} · {row.network} · {row.size_gb}GB
                      </span>
                      {row.error ? (
                        <span className="text-red-400">{row.error}</span>
                      ) : (
                        <span className="text-emerald-400">OK</span>
                      )}
                    </div>
                  ))}
                  {parsedBulk.length > 20 && (
                    <p className="px-4 py-2 text-muted-foreground">…and {parsedBulk.length - 20} more</p>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={submitting || validBulk.length === 0}
              onClick={() => void placeBulk()}
              className="h-11 px-6 rounded-lg bg-primary text-primary-foreground font-black disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : `Submit ${validBulk.length} order(s)`}
            </button>
          </div>
        </Panel>
      )}
    </div>
  )
}
