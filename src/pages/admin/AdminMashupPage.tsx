import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatCard } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { formatCurrency, formatDate } from '../../lib/format'
import { formatMashupData, type AdminMashupPackage } from '../../lib/mashup'
import { supabase } from '../../lib/supabase'

const FULFILL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fulfill-orders`

const SETTING_KEYS = [
  'mashup_enabled',
  'mashup_api_key',
  'mashup_lane_open',
  'mashup_lane_note',
  'mashup_pricing_tier',
  'mashup_provider_balance',
  'mashup_catalog_synced_at',
] as const

type Settings = Partial<Record<(typeof SETTING_KEYS)[number], string>>

export default function AdminMashupPage() {
  const { session } = useAuth()
  const [settings, setSettings] = useState<Settings>({})
  const [packages, setPackages] = useState<AdminMashupPackage[]>([])
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const [{ data: rows }, { data: pkgs }] = await Promise.all([
      supabase.from('site_settings').select('key, value').in('key', [...SETTING_KEYS]),
      supabase.from('mashup_packages').select('*').order('combo_cost'),
    ])
    setSettings(Object.fromEntries((rows ?? []).map((r) => [r.key, r.value ?? ''])))
    const list = ((pkgs as AdminMashupPackage[]) ?? []).map((p) => ({
      ...p,
      price: Number(p.price),
      cost_price: Number(p.cost_price),
      capacity: Number(p.capacity),
    }))
    setPackages(list)
    setPrices(Object.fromEntries(list.map((p) => [p.id, p.price.toFixed(2)])))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveSetting = async (key: string, value: string) => {
    const { error } = await supabase
      .from('site_settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key)
    if (error) throw error
  }

  const syncCatalog = async () => {
    if (!session?.access_token) return
    setSyncing(true)
    setNotice(null)
    const res = await fetch(`${FULFILL_URL}/mashup/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    setSyncing(false)
    if (!body?.success) {
      setNotice({ ok: false, text: body?.error ?? 'Could not reach DataMart' })
    } else {
      setNotice({
        ok: true,
        text: `Synced ${body.packages} packages (tier: ${body.pricing_tier ?? 'unknown'}).${
          body.lane_open ? '' : ' Sales are paused: see the lane status.'
        }`,
      })
    }
    await load()
  }

  const toggleEnabled = async () => {
    const next = settings.mashup_enabled === 'true' ? 'false' : 'true'
    try {
      await saveSetting('mashup_enabled', next)
      setNotice({ ok: true, text: next === 'true' ? 'MTN MashUp is now on sale.' : 'MTN MashUp sales are switched off.' })
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message })
    }
    await load()
  }

  const saveKey = async () => {
    if (!newKey.trim()) return
    try {
      await saveSetting('mashup_api_key', newKey.trim())
      setNewKey('')
      setNotice({ ok: true, text: 'DataMart MashUp API key saved. Run a sync to check it.' })
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message })
    }
    await load()
  }

  const savePackage = async (pkg: AdminMashupPackage, patch: Partial<AdminMashupPackage>) => {
    const price = patch.price ?? pkg.price
    if (!Number.isFinite(price) || price < pkg.cost_price) {
      setNotice({ ok: false, text: `Price for ${pkg.title} can't be below the DataMart cost (${formatCurrency(pkg.cost_price)}).` })
      return
    }
    const { error } = await supabase
      .from('mashup_packages')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', pkg.id)
    setNotice(error ? { ok: false, text: error.message } : { ok: true, text: `${pkg.title} updated.` })
    await load()
  }

  const enabled = settings.mashup_enabled === 'true'
  const laneOpen = settings.mashup_lane_open !== 'false'
  const keySet = Boolean(settings.mashup_api_key)

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="MTN MashUp"
        description="Data + minutes + SMS combo packages bought from DataMart. Users buy them on the MTN MashUp page and through the API."
        action={
          <button
            type="button"
            onClick={() => void syncCatalog()}
            disabled={syncing || !keySet}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from DataMart'}
          </button>
        }
      />

      {notice && (
        <p
          className={`text-sm rounded-lg px-4 py-2 border ${
            notice.ok ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : 'text-red-400 border-red-500/20 bg-red-500/10'
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sales" value={enabled ? 'On' : 'Off'} />
        <StatCard label="DataMart lane" value={laneOpen ? 'Open' : 'Paused'} />
        <StatCard
          label="DataMart balance"
          value={settings.mashup_provider_balance ? formatCurrency(Number(settings.mashup_provider_balance)) : '—'}
        />
        <StatCard
          label="Last sync"
          value={settings.mashup_catalog_synced_at ? formatDate(settings.mashup_catalog_synced_at) : 'Never'}
        />
      </div>

      <Panel title="Status">
        <div className="space-y-4 text-sm">
          {!laneOpen && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 px-4 py-3">
              Orders are paused: {settings.mashup_lane_note || 'DataMart lane closed'}. While Sales is on, this is
              re-checked automatically every 15 minutes, or click Sync. Orders waiting more than 30 minutes while paused are
              refunded.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void toggleEnabled()}
              className={`h-10 px-4 rounded-lg text-sm font-bold ${
                enabled ? 'border border-white/10 bg-secondary/50' : 'bg-primary text-primary-foreground'
              }`}
            >
              {enabled ? 'Switch sales off' : 'Switch sales on'}
            </button>
            <span className="text-muted-foreground">
              Pricing tier at DataMart: <strong>{settings.mashup_pricing_tier || 'unknown'}</strong>
            </span>
          </div>
          <div className="grid gap-2 max-w-xl">
            <span className="text-muted-foreground">
              DataMart API key {keySet ? `(saved, ends …${settings.mashup_api_key!.slice(-4)})` : '(not set)'}
            </span>
            <div className="flex gap-2">
              <input
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Paste a new key to replace it"
                autoComplete="off"
                className="flex-1 h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 outline-none"
              />
              <button
                type="button"
                onClick={() => void saveKey()}
                disabled={!newKey.trim()}
                className="h-10 px-4 rounded-lg border border-white/10 text-sm disabled:opacity-50"
              >
                Save key
              </button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Packages">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : packages.length === 0 ? (
          <EmptyState
            title="No packages yet"
            description="Click Sync from DataMart. DataMart must enable MashUp on the account first; until then it answers MASHUP_NOT_ENABLED."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-white/10">
                  <th className="py-2 pr-3">Package</th>
                  <th className="py-2 pr-3">Contents</th>
                  <th className="py-2 pr-3">DataMart cost</th>
                  <th className="py-2 pr-3">Your price</th>
                  <th className="py-2 pr-3">Margin</th>
                  <th className="py-2 pr-3">On sale</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => {
                  const draft = Number(prices[p.id])
                  const margin = (Number.isFinite(draft) ? draft : p.price) - p.cost_price
                  return (
                    <tr key={p.id} className="border-b border-white/5 align-top">
                      <td className="py-3 pr-3">
                        <p className="font-medium">{p.title}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{p.code}</p>
                        {!p.available && <p className="text-[11px] text-red-400">No longer listed by DataMart</p>}
                      </td>
                      <td className="py-3 pr-3 text-muted-foreground">
                        {formatMashupData(p.mb)} · {p.onnet_mins} MTN min · {p.offnet_mins} other min · {p.sms} SMS ·{' '}
                        {p.validity_days}d
                      </td>
                      <td className="py-3 pr-3">{formatCurrency(p.cost_price)}</td>
                      <td className="py-3 pr-3">
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.01"
                            min={p.cost_price}
                            value={prices[p.id] ?? ''}
                            onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })}
                            className="w-24 h-9 rounded-lg border border-white/10 bg-secondary/50 px-2 outline-none"
                          />
                          {Number(prices[p.id]) !== p.price && (
                            <button
                              type="button"
                              onClick={() => void savePackage(p, { price: Number(prices[p.id]) })}
                              className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold"
                            >
                              Save
                            </button>
                          )}
                        </div>
                      </td>
                      <td className={`py-3 pr-3 font-medium ${margin <= 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {formatCurrency(margin)}
                      </td>
                      <td className="py-3 pr-3">
                        <input
                          type="checkbox"
                          checked={p.active}
                          onChange={(e) => void savePackage(p, { active: e.target.checked })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground mt-3">
              New packages arrive at DataMart cost (no margin) so nothing sells at a loss; set your price before switching sales
              on. If DataMart raises a cost above your price, that package stops selling until you reprice it.
            </p>
          </div>
        )}
      </Panel>
    </div>
  )
}
