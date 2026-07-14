import { useState } from 'react'
import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { PasswordInput } from '../../components/PasswordInput'
import { useAuth } from '../../context/AuthContext'
import { useSiteSettings } from '../../hooks/useAdminData'
import { supabase } from '../../lib/supabase'

const PROVIDER_SETTING_KEYS = new Set([
  'active_data_provider',
  'data_provider_primary_name',
  'data_provider_secondary_name',
  'data_provider_primary_api_key',
  'data_provider_secondary_api_key',
  'data_provider_primary_type',
  'data_provider_secondary_type',
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
      ['active_data_provider', getValue('active_data_provider', 'primary'), 'Active data provider (primary or secondary)'],
      ['data_provider_primary_type', getValue('data_provider_primary_type', 'datahub'), 'Primary provider API type (datahub or skplug)'],
      ['data_provider_secondary_type', getValue('data_provider_secondary_type', 'skplug'), 'Secondary provider API type (datahub or skplug)'],
      ['data_provider_primary_name', getValue('data_provider_primary_name', 'Primary Datahub'), 'Display name for primary provider'],
      ['data_provider_secondary_name', getValue('data_provider_secondary_name', 'SK Plug'), 'Display name for secondary provider'],
      ['data_provider_primary_api_key', getValue('data_provider_primary_api_key'), 'Primary Datahub API key'],
      ['data_provider_secondary_api_key', getValue('data_provider_secondary_api_key'), 'Secondary SK Plug API token'],
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

    if (setting.key === 'maintenance_mode' || setting.key === 'api_enabled' || setting.key === 'provider_fulfillment_enabled') {
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

  const generalSettings = settings.filter((s) => !PROVIDER_SETTING_KEYS.has(s.key))
  const activeProvider = getValue('active_data_provider', 'primary')
  const primaryName = getValue('data_provider_primary_name', 'Primary Datahub')
  const secondaryName = getValue('data_provider_secondary_name', 'SK Plug')
  const primaryType = getValue('data_provider_primary_type', 'datahub')
  const secondaryType = getValue('data_provider_secondary_type', 'skplug')

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
        description="Switch between Datahub (primary) and SK Plug (secondary). The active provider receives all new orders immediately."
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading provider settings…</p>
        ) : (
          <div className="space-y-6 max-w-2xl">
            <div>
              <label className="text-sm font-medium text-foreground/80">Active provider</label>
              <p className="text-[11px] text-muted-foreground mb-2">
                All new order submissions go to the selected provider.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {(['primary', 'secondary'] as const).map((slug) => {
                  const name = slug === 'primary' ? primaryName : secondaryName
                  const type = slug === 'primary' ? primaryType : secondaryType
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
                        {type === 'skplug' ? 'SK Plug API' : 'Datahub API'}
                      </p>
                      {selected && (
                        <p className="text-xs text-emerald-400 mt-2">Active — receiving new orders</p>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div className="space-y-4 rounded-xl border border-white/10 p-4">
                <h3 className="text-sm font-semibold">Primary — Datahub</h3>
                <div>
                  <label className="text-xs text-muted-foreground">Display name</label>
                  <input
                    value={primaryName}
                    onChange={(e) => setDraft({ ...draft, data_provider_primary_name: e.target.value })}
                    className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">API key</label>
                  <PasswordInput
                    value={getValue('data_provider_primary_api_key')}
                    onChange={(e) => setDraft({ ...draft, data_provider_primary_api_key: e.target.value })}
                    placeholder="sk_..."
                    className="mt-1 border-white/10 pl-3"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Base: user.datahubgh.com · Auth: X-API-Key
                </p>
              </div>

              <div className="space-y-4 rounded-xl border border-white/10 p-4">
                <h3 className="text-sm font-semibold">Secondary — SK Plug</h3>
                <div>
                  <label className="text-xs text-muted-foreground">Display name</label>
                  <input
                    value={secondaryName}
                    onChange={(e) => setDraft({ ...draft, data_provider_secondary_name: e.target.value })}
                    className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">API token</label>
                  <PasswordInput
                    value={getValue('data_provider_secondary_api_key')}
                    onChange={(e) => setDraft({ ...draft, data_provider_secondary_api_key: e.target.value })}
                    placeholder="Bearer token…"
                    className="mt-1 border-white/10 pl-3"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Base: skdataplug.com/api/v1 · Auth: Bearer token
                </p>
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
            ['provider_mtn_network_key', 'Datahub MTN network key (YELLO or MTN_XPRESS)'],
            ['active_data_provider', 'Active provider slot (primary Datahub or secondary SK Plug)'],
            ['data_provider_primary_api_key', 'Primary Datahub API key (admin only)'],
            ['data_provider_secondary_api_key', 'Secondary SK Plug API token (admin only)'],
            ['min_topup_amount', 'Minimum wallet top-up in GHS'],
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
