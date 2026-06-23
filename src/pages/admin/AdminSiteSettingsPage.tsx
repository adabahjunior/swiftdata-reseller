import { useState } from 'react'
import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { useSiteSettings } from '../../hooks/useAdminData'
import { supabase } from '../../lib/supabase'

export default function AdminSiteSettingsPage() {
  const { user } = useAuth()
  const { settings, loading, refresh } = useSiteSettings()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const getValue = (key: string, fallback: string) =>
    draft[key] !== undefined ? draft[key] : fallback

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

    if (setting.key === 'maintenance_mode' || setting.key === 'api_enabled') {
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

      <Panel title="Platform Configuration">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading settings…</p>
        ) : settings.length === 0 ? (
          <EmptyState title="No settings found" description="Run the admin schema migration in Supabase." />
        ) : (
          <div className="space-y-5 max-w-2xl">
            {settings.map((setting) => (
              <div key={setting.key}>
                <label className="text-sm font-medium text-foreground/80">
                  {setting.label ?? setting.key}
                </label>
                <p className="text-[10px] text-muted-foreground font-mono mb-1.5">{setting.key}</p>
                {renderInput(setting)}
              </div>
            ))}
            {message && (
              <p className={`text-sm ${message.includes('success') ? 'text-emerald-400' : 'text-destructive'}`}>
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
