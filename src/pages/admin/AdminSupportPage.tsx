import { MessageCircle, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { whatsappLink } from '../../lib/providerStatusSync'
import { supabase } from '../../lib/supabase'
import type { SupportContact } from '../../types/database'

const emptyForm = { label: '', phone: '', display_order: '0' }

export default function AdminSupportPage() {
  const [contacts, setContacts] = useState<SupportContact[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = async () => {
    const { data } = await supabase
      .from('support_contacts')
      .select('*')
      .order('display_order')
      .order('created_at')
    setContacts((data as SupportContact[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const addContact = async () => {
    const label = form.label.trim()
    const phone = form.phone.trim()
    if (!label || !phone) {
      setMessage('Label and WhatsApp number are required.')
      return
    }

    setSaving(true)
    setMessage(null)
    const { error } = await supabase.from('support_contacts').insert({
      label,
      phone,
      display_order: Number(form.display_order) || 0,
      active: true,
    })
    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setForm(emptyForm)
    setMessage('Support contact added.')
    await refresh()
  }

  const toggleActive = async (row: SupportContact) => {
    await supabase.from('support_contacts').update({ active: !row.active, updated_at: new Date().toISOString() }).eq('id', row.id)
    await refresh()
  }

  const remove = async (id: string) => {
    if (!confirm('Remove this support contact?')) return
    await supabase.from('support_contacts').delete().eq('id', id)
    await refresh()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Support WhatsApp"
        description="Numbers shown to users for order complaints and support. Users open WhatsApp with a pre-filled message."
      />

      <Panel title="Add support number">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Label</label>
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Orders Support"
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">WhatsApp number</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="0241234567 or 233..."
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Sort order</label>
            <input
              type="number"
              value={form.display_order}
              onChange={(e) => setForm({ ...form, display_order: e.target.value })}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void addContact()}
            disabled={saving}
            className="h-10 rounded-lg bg-red-500 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
        {message && (
          <p className={`text-sm mt-3 ${message.includes('added') ? 'text-emerald-400' : 'text-destructive'}`}>
            {message}
          </p>
        )}
      </Panel>

      <Panel title="Active contacts for users">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : contacts.length === 0 ? (
          <EmptyState title="No support numbers" description="Add a WhatsApp number so users can reach you." />
        ) : (
          <div className="space-y-3">
            {contacts.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3"
              >
                <div>
                  <p className="font-semibold">{c.label}</p>
                  <p className="text-sm text-muted-foreground font-mono">{c.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={whatsappLink(c.phone, 'Test message from admin')}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:underline"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Preview
                  </a>
                  <button
                    type="button"
                    onClick={() => void toggleActive(c)}
                    className="text-xs font-bold text-primary hover:underline"
                  >
                    {c.active ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(c.id)}
                    className="text-destructive p-1 rounded hover:bg-destructive/10"
                    aria-label="Delete contact"
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
