import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { useAdminNotifications } from '../../hooks/useAdminData'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import type { Notification } from '../../types/database'

const emptyForm = {
  title: '',
  message: '',
  type: 'info' as Notification['type'],
  target: 'all' as Notification['target'],
}

export default function AdminNotificationsPage() {
  const { user } = useAuth()
  const { notifications, loading, refresh } = useAdminNotifications()
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!form.title.trim() || !form.message.trim() || !user) return
    setSaving(true)
    setMessage(null)

    const { error } = await supabase.from('notifications').insert({
      title: form.title.trim(),
      message: form.message.trim(),
      type: form.type,
      target: form.target,
      is_active: true,
      created_by: user.id,
    })

    setSaving(false)
    if (error) {
      setMessage(error.message)
      return
    }

    setForm(emptyForm)
    setMessage('Notification published successfully.')
    await refresh()
  }

  const toggleActive = async (notification: Notification) => {
    await supabase
      .from('notifications')
      .update({ is_active: !notification.is_active })
      .eq('id', notification.id)
    await refresh()
  }

  const deleteNotification = async (id: string) => {
    if (!confirm('Delete this notification?')) return
    await supabase.from('notifications').delete().eq('id', id)
    await refresh()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Notifications"
        description="Broadcast announcements to platform users."
      />

      <Panel title="Create Notification">
        <div className="space-y-4 max-w-2xl">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
              placeholder="System maintenance scheduled"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Message</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-lg border border-white/10 bg-secondary/50 px-3 py-2 text-sm outline-none resize-none"
              placeholder="The API will be unavailable from 2–4 AM GMT."
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as Notification['type'] })}
                className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
              >
                {['info', 'warning', 'success', 'error'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Target</label>
              <select
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value as Notification['target'] })}
                className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
              >
                <option value="all">All users</option>
                <option value="users">API users only</option>
                <option value="admins">Admins only</option>
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="h-10 px-6 rounded-lg bg-red-500 text-white font-bold inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            {saving ? 'Publishing…' : 'Publish Notification'}
          </button>
          {message && (
            <p className={`text-sm ${message.includes('success') ? 'text-emerald-400' : 'text-destructive'}`}>
              {message}
            </p>
          )}
        </div>
      </Panel>

      <Panel title="All Notifications" description={`${notifications.length} notification(s)`}>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : notifications.length === 0 ? (
          <EmptyState title="No notifications" description="Create your first platform announcement above." />
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => (
              <div
                key={n.id}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-bold">{n.title}</h3>
                    <StatusBadge status={n.type} />
                    <StatusBadge status={n.is_active ? 'active' : 'inactive'} />
                    <span className="text-[10px] uppercase text-muted-foreground font-bold">
                      → {n.target}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-2">{formatDate(n.created_at)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActive(n)}
                    className="text-xs font-bold text-primary hover:underline"
                  >
                    {n.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteNotification(n.id)}
                    className="text-destructive hover:bg-destructive/10 rounded p-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
