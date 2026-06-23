import { Copy, Key, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { useApiKeys } from '../../hooks/useDashboardData'
import { API_BASE_URL } from '../../lib/constants'
import { formatDate, generateApiKey } from '../../lib/format'
import { supabase } from '../../lib/supabase'

export default function MyApiPage() {
  const { user } = useAuth()
  const { keys, loading, refresh } = useApiKeys()
  const [newKeyName, setNewKeyName] = useState('Production Key')
  const [creating, setCreating] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateKey = async () => {
    if (!user) return
    setCreating(true)
    setError(null)

    const keyValue = generateApiKey()
    const { error: insertError } = await supabase.from('api_keys').insert({
      user_id: user.id,
      name: newKeyName.trim() || 'API Key',
      key_value: keyValue,
      key_prefix: keyValue.slice(0, 16),
    })

    setCreating(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setRevealedKey(keyValue)
    await refresh()
  }

  const handleRevoke = async (id: string) => {
    await supabase.from('api_keys').update({ is_active: false }).eq('id', id)
    await refresh()
  }

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const activeKey = keys.find((k) => k.is_active)

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="My API"
        description="Manage API keys and connect your applications to purchase data programmatically."
      />

      <Panel title="API Base URL">
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3">
          <code className="text-sm font-mono text-primary flex-1 truncate">{API_BASE_URL}</code>
          <button
            type="button"
            onClick={() => copyKey(API_BASE_URL)}
            className="h-9 w-9 rounded-lg border border-white/10 grid place-items-center hover:bg-white/5"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
        {copied && <p className="text-xs text-emerald-400 mt-2">Copied to clipboard</p>}
      </Panel>

      {revealedKey && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <p className="font-bold text-primary mb-2">Save your API key — it won't be shown again</p>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-3">
            <code className="text-sm font-mono flex-1 break-all">{revealedKey}</code>
            <button
              type="button"
              onClick={() => copyKey(revealedKey)}
              className="h-9 w-9 rounded-lg border border-white/10 grid place-items-center hover:bg-white/5 shrink-0"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setRevealedKey(null)}
            className="text-sm text-muted-foreground mt-3 hover:text-foreground"
          >
            I've saved it, dismiss
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Generate New Key">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground/80">Key Name</label>
              <input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Production Key"
                className="mt-1.5 w-full h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none focus:border-primary/40"
              />
            </div>
            <button
              type="button"
              onClick={handleCreateKey}
              disabled={creating}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'Generating…' : 'Generate API Key'}
            </button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </Panel>

        <Panel title="Quick Test">
          <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto text-muted-foreground">
{`curl -X GET "${API_BASE_URL}/v1/balance" \\
  -H "Authorization: Bearer ${activeKey ? activeKey.key_prefix + '...' : 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json"`}
          </pre>
        </Panel>
      </div>

      <Panel title="Your API Keys" description={`${keys.length} key(s) total`}>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading keys…</p>
        ) : keys.length === 0 ? (
          <EmptyState
            title="No API keys yet"
            description="Generate your first key to start making API requests."
          />
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Key className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{key.name}</span>
                    <StatusBadge status={key.is_active ? 'active' : 'inactive'} />
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-1">{key.key_prefix}••••••••</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created {formatDate(key.created_at)} · {key.requests_count} requests
                    {key.last_used_at && ` · Last used ${formatDate(key.last_used_at)}`}
                  </p>
                </div>
                {key.is_active && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(key.id)}
                    className="inline-flex items-center gap-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-lg px-3 py-2 shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
