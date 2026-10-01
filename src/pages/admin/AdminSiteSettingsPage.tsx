import { useState } from 'react'
import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { PasswordInput } from '../../components/PasswordInput'
import { useAuth } from '../../context/AuthContext'
import { useSiteSettings } from '../../hooks/useAdminData'
import {
  bundlezoneWebhookUrl,
  providerWebhookUrl,
  spendlessWebhookUrl,
  verificationWebhookUrl,
} from '../../lib/providerStatusSync'
import { supabase } from '../../lib/supabase'

const PROVIDER_TYPES = [
  { id: 'datahub', label: 'Datahub', hint: 'user.datahubgh.com · X-API-Key', defaultName: 'Datahub' },
  { id: 'skplug', label: 'SK Plug', hint: 'skdataplug.com/api/v1 · Bearer token', defaultName: 'SK Plug' },
  { id: 'datamart', label: 'DataMart GH', hint: 'api.datamartgh.shop/api/developer · X-API-Key', defaultName: 'DataMart GH' },
  { id: 'bundlezone', label: 'BundleZone', hint: 'bundlezone.shop/api · x-api-key', defaultName: 'BundleZone' },
  { id: 'spendless', label: 'Spendless', hint: 'spendless.top/api · X-API-Key', defaultName: 'Spendless' },
] as const

function providerTypeLabel(type: string) {
  return PROVIDER_TYPES.find((t) => t.id === type)?.label ?? type
}

function providerTypeHint(type: string) {
  return PROVIDER_TYPES.find((t) => t.id === type)?.hint ?? ''
}

const PROVIDER_SLOTS = [
  { slug: 'primary', title: 'Primary', defaultType: 'datahub', defaultName: 'Primary Datahub' },
  { slug: 'secondary', title: 'Secondary', defaultType: 'skplug', defaultName: 'SK Plug' },
  { slug: 'tertiary', title: 'Tertiary', defaultType: 'datahub', defaultName: 'Datahub' },
  { slug: 'quaternary', title: 'Quaternary', defaultType: 'bundlezone', defaultName: 'BundleZone' },
  { slug: 'quinary', title: 'Quinary', defaultType: 'spendless', defaultName: 'Spendless' },
] as const

const PROVIDER_TYPE_LIST = 'datahub, skplug, datamart, bundlezone, or spendless'

const PROVIDER_SETTING_KEYS = new Set([
  'active_data_provider',
  ...PROVIDER_SLOTS.flatMap(({ slug }) => [
    `data_provider_${slug}_name`,
    `data_provider_${slug}_api_key`,
    `data_provider_${slug}_type`,
  ]),
  'datamart_api_key',
  'datamart_name',
  'datahub_webhook_secret',
  'bundlezone_webhook_secret',
  'spendless_webhook_secret',
  'provider_auto_reroute_enabled',
  'provider_reroute_chain',
  'skplug_refund_reroute_enabled',
  'provider_refund_reroute_max_age_hours',
  'skplug_refund_sync_last_at',
])

const DEFAULT_REROUTE_CHAIN = PROVIDER_SLOTS.map((s) => s.slug).join(',')

const XCEL_SETTING_KEYS = new Set([
  'xcel_enabled',
  'xcel_api_base',
  'xcel_dl_code_path',
  'xcel_buy_path',
  'xcel_user_id',
  'xcel_pin',
  'xcel_from_acct',
  'xcel_hmac_secret',
  'xcel_api_key',
  'xcel_default_merchant_id',
  'xcel_biller_channel',
])

export default function AdminSiteSettingsPage() {
  const { user } = useAuth()
  const { settings, loading, refresh } = useSiteSettings()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const getValue = (key: string, fallback = '') =>
    draft[key] !== undefined ? draft[key] : (settings.find((s) => s.key === key)?.value ?? fallback)

  const upsertSetting = async (key: string, value: string, label: string) => {
    if (!user) return false
    const { error } = await supabase.from('site_settings').upsert(
      {
        key,
        value,
        label,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
    return !error
  }

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    setMessage(null)

    const updates = settings.map((setting) => ({
      key: setting.key,
      value: getValue(setting.key, setting.value),
      label: setting.label,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }))

    for (const update of updates) {
      const { error } = await supabase
        .from('site_settings')
        .upsert(update, { onConflict: 'key' })

      if (error) {
        setSaving(false)
        setMessage(error.message)
        return
      }
    }

    setDraft({})
    setSaving(false)
    setMessage('Site settings saved successfully.')
    await refresh()
  }

  const handleSaveProviders = async () => {
    if (!user) return
    setSaving(true)
    setMessage(null)

    const providerUpdates: Array<[string, string, string]> = [
      ['active_data_provider', getValue('active_data_provider', 'primary'), 'Active data provider (primary, secondary, tertiary, quaternary, or quinary)'],
      ...PROVIDER_SLOTS.flatMap(({ slug, title, defaultType, defaultName }): Array<[string, string, string]> => [
        [`data_provider_${slug}_type`, getValue(`data_provider_${slug}_type`, defaultType), `${title} provider API type (${PROVIDER_TYPE_LIST})`],
        [`data_provider_${slug}_name`, getValue(`data_provider_${slug}_name`, defaultName), `Display name for ${slug} provider`],
        [`data_provider_${slug}_api_key`, getValue(`data_provider_${slug}_api_key`), `${title} provider API key`],
      ]),
      ['datamart_api_key', getValue('datamart_api_key'), 'DataMart GH API key (number verification fallback)'],
      ['datamart_name', getValue('datamart_name', 'DataMart GH'), 'DataMart display name'],
      ['datahub_webhook_secret', getValue('datahub_webhook_secret'), 'Datahub HMAC secret for X-Webhook-Signature'],
      ['bundlezone_webhook_secret', getValue('bundlezone_webhook_secret'), 'BundleZone webhook secret for X-BundleZone-Signature'],
      ['spendless_webhook_secret', getValue('spendless_webhook_secret'), 'Spendless webhook secret for X-Webhook-Signature'],
      ['provider_auto_reroute_enabled', getValue('provider_auto_reroute_enabled', 'true'), 'Automatically re-send rejected orders to the next provider'],
      ['provider_reroute_chain', getValue('provider_reroute_chain', DEFAULT_REROUTE_CHAIN), 'Fallback order of provider slots for auto re-routing'],
      ['skplug_refund_reroute_enabled', getValue('skplug_refund_reroute_enabled', 'true'), 'Re-route SK Plug refunded orders to the next provider'],
      [
        'provider_refund_reroute_max_age_hours',
        String(Math.max(1, Number(getValue('provider_refund_reroute_max_age_hours', '48')) || 48)),
        'Only re-route refunds of orders placed within this many hours',
      ],
    ]

    for (const [key, value, label] of providerUpdates) {
      const ok = await upsertSetting(key, value, label)
      if (!ok) {
        setSaving(false)
        setMessage(`Failed to save ${key}`)
        return
      }
    }

    setDraft((prev) => {
      const next = { ...prev }
      for (const [key] of providerUpdates) {
        delete next[key]
      }
      return next
    })
    setSaving(false)
    setMessage('Data provider settings saved. New orders will use the active provider immediately.')
    await refresh()
  }

  const handleSaveXcel = async () => {
    if (!user) return
    setSaving(true)
    setMessage(null)

    const xcelUpdates: Array<[string, string, string]> = [
      ['xcel_api_key', getValue('xcel_api_key'), 'Xcel public/API key (X-API-KEY header)'],
      ['xcel_default_merchant_id', getValue('xcel_default_merchant_id'), 'Xcel merchant ID (X-MERCHANT-ID + body merchant)'],
      ['xcel_biller_channel', getValue('xcel_biller_channel', 'FUNDGATE'), 'Xcel biller_channel'],
      ['xcel_user_id', getValue('xcel_user_id'), 'Xcel partner user_id (required for buy)'],
      ['xcel_pin', getValue('xcel_pin'), 'Xcel partner PIN'],
      ['xcel_from_acct', getValue('xcel_from_acct'), 'Xcel debit/from account number'],
      ['xcel_hmac_secret', getValue('xcel_hmac_secret'), 'Xcel HMAC / API secret'],
      ['xcel_enabled', getValue('xcel_enabled', 'false'), 'Enable Xcel Airtime / ECG / TV fulfillment'],
      ['xcel_api_base', getValue('xcel_api_base', 'https://api.xcelapp.com'), 'Xcel API base URL'],
      ['xcel_dl_code_path', getValue('xcel_dl_code_path', '/partners/momo/dl-code'), 'Xcel DL-code path'],
      ['xcel_buy_path', getValue('xcel_buy_path', '/partners/utilities/buy'), 'Xcel utilities buy path'],
    ]

    for (const [key, value, label] of xcelUpdates) {
      const ok = await upsertSetting(key, value, label)
      if (!ok) {
        setSaving(false)
        setMessage(`Failed to save ${key}`)
        return
      }
    }

    setDraft((prev) => {
      const next = { ...prev }
      for (const [key] of xcelUpdates) delete next[key]
      return next
    })
    setSaving(false)
    setMessage('Xcel utility settings saved.')
    await refresh()
  }

  const renderInput = (setting: { key: string; value: string; label: string | null }) => {
    const value = getValue(setting.key, setting.value)

    if (setting.key === 'order_auto_deliver_seconds') {
      return (
        <div className="space-y-1">
          <input
            type="number"
            min={0}
            step={1}
            value={value}
            onChange={(e) => setDraft({ ...draft, [setting.key]: e.target.value })}
            className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
          />
          <p className="text-[11px] text-muted-foreground">
            Seconds after order creation to auto-mark as delivered. Set 0 to disable (instant deliver on API).
          </p>
        </div>
      )
    }

    if (setting.key === 'provider_mtn_network_key') {
      return (
        <select
          value={value}
          onChange={(e) => setDraft({ ...draft, [setting.key]: e.target.value })}
          className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
        >
          <option value="YELLO">YELLO (standard MTN)</option>
          <option value="MTN_XPRESS">MTN_XPRESS (express)</option>
        </select>
      )
    }

    if (setting.key === 'maintenance_mode' || setting.key === 'api_enabled' || setting.key === 'provider_fulfillment_enabled' || setting.key === 'provider_status_sync_enabled' || setting.key === 'sms_enabled' || setting.key === 'xcel_enabled') {
      return (
        <select
          value={value}
          onChange={(e) => setDraft({ ...draft, [setting.key]: e.target.value })}
          className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
        >
          <option value="true">Enabled / True</option>
          <option value="false">Disabled / False</option>
        </select>
      )
    }

    if (setting.key === 'sms_api_key' || setting.key === 'xcel_pin' || setting.key === 'xcel_hmac_secret' || setting.key === 'xcel_api_key') {
      return (
        <PasswordInput
          value={value}
          onChange={(e) => setDraft({ ...draft, [setting.key]: e.target.value })}
          className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
        />
      )
    }

    if (setting.key === 'platform_notice') {
      return (
        <textarea
          value={value}
          onChange={(e) => setDraft({ ...draft, [setting.key]: e.target.value })}
          rows={3}
          className="w-full rounded-lg border border-white/10 bg-secondary/50 px-3 py-2 text-sm outline-none resize-none"
        />
      )
    }

    return (
      <input
        value={value}
        onChange={(e) => setDraft({ ...draft, [setting.key]: e.target.value })}
        className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
      />
    )
  }

  const generalSettings = settings.filter(
    (s) => !PROVIDER_SETTING_KEYS.has(s.key) && !XCEL_SETTING_KEYS.has(s.key),
  )
  const xcelSettings = settings.filter((s) => XCEL_SETTING_KEYS.has(s.key))
  const activeProvider = getValue('active_data_provider', 'primary')
  const slots = PROVIDER_SLOTS.map((slot) => ({
    ...slot,
    name: getValue(`data_provider_${slot.slug}_name`, slot.defaultName),
    type: getValue(`data_provider_${slot.slug}_type`, slot.defaultType),
    hasKey: Boolean(getValue(`data_provider_${slot.slug}_api_key`).trim()),
  }))
  const rerouteEnabled = getValue('provider_auto_reroute_enabled', 'true') !== 'false'
  const refundRerouteEnabled = getValue('skplug_refund_reroute_enabled', 'true') !== 'false'
  const rerouteChain = getValue('provider_reroute_chain', DEFAULT_REROUTE_CHAIN)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => slots.some((slot) => slot.slug === s))
  const rerouteRows = [
    ...rerouteChain.map((slug) => ({ slug, included: true })),
    ...slots.filter((s) => !rerouteChain.includes(s.slug)).map((s) => ({ slug: s.slug, included: false })),
  ].map((row) => ({ ...row, slot: slots.find((s) => s.slug === row.slug)! }))

  const setRerouteChain = (next: string[]) =>
    setDraft({ ...draft, provider_reroute_chain: next.join(',') })

  const moveInChain = (slug: string, delta: number) => {
    const next = [...rerouteChain]
    const from = next.indexOf(slug)
    const to = from + delta
    if (from < 0 || to < 0 || to >= next.length) return
    ;[next[from], next[to]] = [next[to], next[from]]
    setRerouteChain(next)
  }

  const toggleInChain = (slug: string) =>
    setRerouteChain(
      rerouteChain.includes(slug) ? rerouteChain.filter((s) => s !== slug) : [...rerouteChain, slug],
    )

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Site Settings"
        description="Configure platform-wide settings for SwiftData Reseller."
        action={
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="h-11 px-6 rounded-lg bg-red-500 text-white font-bold disabled:opacity-60 shrink-0"
          >
            {saving ? 'Saving…' : 'Save All Settings'}
          </button>
        }
      />

      <Panel
        title="Data Providers"
        description="Choose Datahub, SK Plug, DataMart GH, BundleZone, or Spendless for each slot. The active slot receives all new data orders."
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading provider settings…</p>
        ) : (
          <div className="space-y-6 max-w-3xl">
            <div>
              <label className="text-sm font-medium text-foreground/80">Active provider</label>
              <p className="text-[11px] text-muted-foreground mb-2">
                All new order submissions go to the selected provider.
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {slots.map(({ slug, name, type }) => {
                  const selected = activeProvider === slug
                  return (
                    <button
                      key={slug}
                      type="button"
                      onClick={() => setDraft({ ...draft, active_data_provider: slug })}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        selected
                          ? 'border-red-500/50 bg-red-500/10 ring-1 ring-red-500/30'
                          : 'border-white/10 bg-secondary/30 hover:bg-secondary/50'
                      }`}
                    >
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{slug}</p>
                      <p className="font-semibold mt-1">{name}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {providerTypeLabel(type)} API
                      </p>
                      {selected && (
                        <p className="text-xs text-emerald-400 mt-2">Active — receiving new orders</p>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {slots.map(({ slug, title, name, type }) => (
                <div key={slug} className="space-y-4 rounded-xl border border-white/10 p-4">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <div>
                    <label className="text-xs text-muted-foreground">API type</label>
                    <select
                      value={type}
                      onChange={(e) => {
                        const nextType = e.target.value
                        const nameKey = `data_provider_${slug}_name`
                        setDraft({
                          ...draft,
                          [`data_provider_${slug}_type`]: nextType,
                          [nameKey]:
                            draft[nameKey] ??
                            PROVIDER_TYPES.find((t) => t.id === nextType)?.defaultName ??
                            name,
                        })
                      }}
                      className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
                    >
                      {PROVIDER_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Display name</label>
                    <input
                      value={name}
                      onChange={(e) => setDraft({ ...draft, [`data_provider_${slug}_name`]: e.target.value })}
                      className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">API key / token</label>
                    <PasswordInput
                      value={getValue(`data_provider_${slug}_api_key`)}
                      onChange={(e) => setDraft({ ...draft, [`data_provider_${slug}_api_key`]: e.target.value })}
                      placeholder="API credential…"
                      className="mt-1 border-white/10 pl-3"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">{providerTypeHint(type)}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/10 p-4 space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="max-w-xl">
                  <h3 className="text-sm font-semibold">Auto re-routing</h3>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    When a provider definitely rejects an order, or later reports it failed, the order is sent to
                    the next provider below until one accepts it. The active provider is always tried first. Each
                    provider receives an order at most once per routing round. Unclear responses (timeouts, server
                    errors) are never re-routed and are flagged for review instead, so nothing is bought twice.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({ ...draft, provider_auto_reroute_enabled: rerouteEnabled ? 'false' : 'true' })
                  }
                  className={`h-9 px-4 rounded-lg border text-xs font-bold shrink-0 ${
                    rerouteEnabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-white/10 bg-secondary/40 text-muted-foreground'
                  }`}
                >
                  {rerouteEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className={`space-y-2 ${rerouteEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                <p className="text-xs text-muted-foreground">Fallback order</p>
                {rerouteRows.map(({ slug, included, slot }) => {
                  const position = rerouteChain.indexOf(slug)
                  return (
                    <div
                      key={slug}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                        included ? 'border-white/10 bg-secondary/30' : 'border-white/5 bg-transparent opacity-60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => toggleInChain(slug)}
                        aria-label={`Include ${slot.name} in re-routing`}
                        className="rounded border-white/20"
                      />
                      <span className="w-5 text-xs font-mono text-muted-foreground">
                        {included ? position + 1 : '—'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {slot.name}{' '}
                          <span className="text-[11px] text-muted-foreground">
                            ({slot.title} · {providerTypeLabel(slot.type)})
                          </span>
                        </p>
                        {!slot.hasKey && (
                          <p className="text-[10px] text-amber-400">No API key — skipped</p>
                        )}
                        {activeProvider === slug && (
                          <p className="text-[10px] text-emerald-400">Active — always tried first</p>
                        )}
                      </div>
                      {included && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => moveInChain(slug, -1)}
                            disabled={position === 0}
                            aria-label={`Move ${slot.name} up`}
                            className="h-7 w-7 rounded border border-white/10 text-xs disabled:opacity-30 hover:bg-white/5"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveInChain(slug, 1)}
                            disabled={position === rerouteChain.length - 1}
                            aria-label={`Move ${slot.name} down`}
                            className="h-7 w-7 rounded border border-white/10 text-xs disabled:opacity-30 hover:bg-white/5"
                          >
                            ↓
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div
                className={`flex items-start justify-between gap-4 flex-wrap border-t border-white/10 pt-4 ${
                  rerouteEnabled ? '' : 'opacity-50 pointer-events-none'
                }`}
              >
                <div className="max-w-xl">
                  <p className="text-sm font-medium">Re-route SK Plug refunds</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    SK Plug orders that come back refunded (not delivered) are sent to the next provider, even after
                    the order shows as delivered. Checked through SK Plug orders-summary every 2 minutes. Orders
                    already marked failed are never re-sent.
                  </p>
                  <label className="text-[11px] text-muted-foreground mt-2 flex items-center gap-2">
                    Only refunds of orders placed in the last
                    <input
                      type="number"
                      min={1}
                      value={getValue('provider_refund_reroute_max_age_hours', '48')}
                      onChange={(e) => setDraft({ ...draft, provider_refund_reroute_max_age_hours: e.target.value })}
                      className="h-7 w-16 rounded border border-white/10 bg-secondary/40 px-2 text-xs"
                    />
                    hours
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({ ...draft, skplug_refund_reroute_enabled: refundRerouteEnabled ? 'false' : 'true' })
                  }
                  className={`h-9 px-4 rounded-lg border text-xs font-bold shrink-0 ${
                    refundRerouteEnabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-white/10 bg-secondary/40 text-muted-foreground'
                  }`}
                >
                  {refundRerouteEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 p-4 space-y-3 max-w-xl">
              <h3 className="text-sm font-semibold">Number verification</h3>
              <p className="text-[11px] text-muted-foreground">
                Dashboard and API verify-number calls use Datahub{' '}
                <span className="font-mono">/purchases/verify-number</span> (tertiary key). Unverified numbers
                are auto-submitted on Datahub; explicit queue also calls{' '}
                <span className="font-mono">/purchases/submit-numbers</span>. DataMart remains a fallback.
              </p>
              <div>
                <label className="text-xs text-muted-foreground">DataMart API key (fallback)</label>
                <PasswordInput
                  value={getValue('datamart_api_key')}
                  onChange={(e) => setDraft({ ...draft, datamart_api_key: e.target.value })}
                  placeholder="DataMart X-API-Key…"
                  className="mt-1 border-white/10 pl-3"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Datahub webhook HMAC secret</label>
                <PasswordInput
                  value={getValue('datahub_webhook_secret')}
                  onChange={(e) => setDraft({ ...draft, datahub_webhook_secret: e.target.value })}
                  placeholder="Optional HMAC secret from the Datahub webhook"
                  className="mt-1 border-white/10 pl-3"
                />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 p-4 space-y-3 max-w-xl">
              <h3 className="text-sm font-semibold">BundleZone webhook</h3>
              <p className="text-[11px] text-muted-foreground">
                On your BundleZone API client, set this callback URL and a strong webhook secret, then paste the
                same secret here. Callbacks are rejected until the secret is saved. Orders are also polled via{' '}
                <span className="font-mono">GET /api/status.php</span>.
              </p>
              <div className="flex flex-wrap gap-2">
                <code className="flex-1 min-w-0 text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-3 break-all">
                  {bundlezoneWebhookUrl()}
                </code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(bundlezoneWebhookUrl())}
                  className="h-10 px-4 rounded-lg border border-white/10 text-sm font-bold hover:bg-white/5 shrink-0"
                >
                  Copy URL
                </button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">BundleZone webhook secret</label>
                <PasswordInput
                  value={getValue('bundlezone_webhook_secret')}
                  onChange={(e) => setDraft({ ...draft, bundlezone_webhook_secret: e.target.value })}
                  placeholder="Same secret as on your BundleZone API client"
                  className="mt-1 border-white/10 pl-3"
                />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 p-4 space-y-3 max-w-xl">
              <h3 className="text-sm font-semibold">Spendless webhook</h3>
              <p className="text-[11px] text-muted-foreground">
                This URL is sent with every Spendless order automatically. If you set an Order Delivery Webhook URL on
                your Spendless dashboard it overrides ours, so either leave it blank or paste this URL there. Every
                callback is confirmed against <span className="font-mono">GET /api/transactions</span> before an order
                changes, and orders are also polled from there.
              </p>
              <div className="flex flex-wrap gap-2">
                <code className="flex-1 min-w-0 text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-3 break-all">
                  {spendlessWebhookUrl()}
                </code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(spendlessWebhookUrl())}
                  className="h-10 px-4 rounded-lg border border-white/10 text-sm font-bold hover:bg-white/5 shrink-0"
                >
                  Copy URL
                </button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Spendless webhook secret (optional)</label>
                <PasswordInput
                  value={getValue('spendless_webhook_secret')}
                  onChange={(e) => setDraft({ ...draft, spendless_webhook_secret: e.target.value })}
                  placeholder="HMAC secret used for X-Webhook-Signature"
                  className="mt-1 border-white/10 pl-3"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveProviders()}
              disabled={saving || loading}
              className="h-10 px-5 rounded-lg bg-red-500 text-white text-sm font-bold disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Provider Settings'}
            </button>
            {message && (
              <p className={`text-sm ${message.includes('success') || message.includes('immediately') ? 'text-emerald-400' : 'text-destructive'}`}>
                {message}
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Xcel Utilities (Airtime / ECG / TV)"
        description="Credentials from your Xcel partner portal and VAS list. Docs: https://docs.xcelapp.com — buy endpoint POST /partners/utilities/buy."
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading Xcel settings…</p>
        ) : (
          <div className="space-y-5 max-w-2xl">
            {(xcelSettings.length > 0
              ? xcelSettings
              : [...XCEL_SETTING_KEYS].map((key) => ({
                  key,
                  value: '',
                  label: key,
                }))
            ).map((setting) => (
              <div key={setting.key}>
                <label className="text-sm font-medium text-foreground/80">
                  {setting.label ?? setting.key}
                </label>
                <p className="text-[10px] text-muted-foreground font-mono mb-1.5">{setting.key}</p>
                {renderInput(setting)}
              </div>
            ))}
            <button
              type="button"
              onClick={() => void handleSaveXcel()}
              disabled={saving || loading}
              className="h-10 px-5 rounded-lg bg-red-500 text-white text-sm font-bold disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Xcel Settings'}
            </button>
          </div>
        )}
      </Panel>

      <Panel
        title="Live order status (Datahub)"
        description="Register these webhook URLs on the Datahub API key (Webhooks tab). Datahub currently emits order.status.changed. We also poll every 15 seconds when sync is enabled."
      >
        <label className="text-xs font-medium text-muted-foreground">Order status webhook</label>
        <div className="mt-1 flex flex-wrap gap-2">
          <code className="flex-1 min-w-0 text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-3 break-all">
            {providerWebhookUrl()}
          </code>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(providerWebhookUrl())}
            className="h-10 px-4 rounded-lg border border-white/10 text-sm font-bold hover:bg-white/5 shrink-0"
          >
            Copy URL
          </button>
        </div>
        <label className="text-xs font-medium text-muted-foreground mt-4 block">Number verification webhook</label>
        <div className="mt-1 flex flex-wrap gap-2">
          <code className="flex-1 min-w-0 text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-3 break-all">
            {verificationWebhookUrl()}
          </code>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(verificationWebhookUrl())}
            className="h-10 px-4 rounded-lg border border-white/10 text-sm font-bold hover:bg-white/5 shrink-0"
          >
            Copy URL
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Event: <span className="font-mono">order.status.changed</span>. Header:{' '}
          <span className="font-mono">X-Webhook-Signature</span> (HMAC-SHA256). SK Plug uses{' '}
          <span className="font-mono">GET /status/&#123;order_id&#125;/</span>. DataMart uses{' '}
          <span className="font-mono">GET /order-status/&#123;reference&#125;</span>.
        </p>
      </Panel>

      <Panel title="Platform Configuration">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading settings…</p>
        ) : generalSettings.length === 0 ? (
          <EmptyState title="No settings found" description="Run the admin schema migration in Supabase." />
        ) : (
          <div className="space-y-5 max-w-2xl">
            {generalSettings.map((setting) => (
              <div key={setting.key}>
                <label className="text-sm font-medium text-foreground/80">
                  {setting.label ?? setting.key}
                </label>
                <p className="text-[10px] text-muted-foreground font-mono mb-1.5">{setting.key}</p>
                {renderInput(setting)}
              </div>
            ))}
            {message && (
              <p className={`text-sm ${message.includes('success') || message.includes('immediately') ? 'text-emerald-400' : 'text-destructive'}`}>
                {message}
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Setting Keys Reference">
        <dl className="grid sm:grid-cols-2 gap-3 text-sm">
          {[
            ['maintenance_mode', 'Blocks API access when true'],
            ['api_enabled', 'Master switch for the API'],
            ['order_auto_deliver_seconds', 'Auto-deliver pending orders after N seconds'],
            ['provider_fulfillment_enabled', 'Forward successful orders to the active provider'],
            ['provider_status_sync_enabled', 'Poll provider APIs for live order status updates'],
            ['provider_mtn_network_key', 'Datahub MTN network key (YELLO or MTN_XPRESS)'],
            ['active_data_provider', 'Active provider slot (primary, secondary, tertiary, quaternary, or quinary)'],
            ['data_provider_primary_api_key', 'Primary provider API key (admin only)'],
            ['data_provider_secondary_api_key', 'Secondary provider API key/token (admin only)'],
            ['data_provider_tertiary_api_key', 'Tertiary provider API key (admin only)'],
            ['data_provider_quaternary_api_key', 'Quaternary provider API key, BundleZone by default (admin only)'],
            ['datahub_webhook_secret', 'Datahub HMAC webhook secret'],
            ['bundlezone_webhook_secret', 'BundleZone webhook signing secret'],
            ['data_provider_quinary_api_key', 'Quinary provider API key, Spendless by default (admin only)'],
            ['spendless_webhook_secret', 'Spendless webhook signing secret (optional)'],
            ['min_topup_amount', 'Minimum wallet top-up in GHS'],
            ['sms_enabled', 'Send SMS via TXTConnect (credit, failed orders, low balance)'],
            ['sms_api_key', 'TXTConnect API key'],
            ['sms_sender_id', 'TXTConnect sender ID (e.g. swiftupdate)'],
            ['xcel_enabled', 'Enable Airtime / ECG / TV via Xcel'],
            ['xcel_user_id', 'Xcel partner user_id'],
            ['xcel_from_acct', 'Xcel from_acct wallet'],
            ['xcel_default_merchant_id', 'Default merchant ID from VAS list'],
            ['platform_notice', 'Banner shown to users on login'],
          ].map(([key, desc]) => (
            <div key={key} className="rounded-lg border border-white/10 px-3 py-2">
              <dt className="font-mono text-xs text-red-400">{key}</dt>
              <dd className="text-muted-foreground text-xs mt-0.5">{desc}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  )
}
