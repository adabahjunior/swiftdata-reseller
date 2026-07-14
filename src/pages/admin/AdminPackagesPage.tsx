import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { PACKAGE_NETWORKS } from '../../lib/constants'
import { formatCurrency, formatNetwork } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { DataPackage } from '../../types/database'

const emptyForm = {
  network: 'mtn',
  size_gb: '',
  price: '',
  validity: 'Non expiry',
}

export default function AdminPackagesPage() {
  const [packages, setPackages] = useState<DataPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = async () => {
    const { data } = await supabase
      .from('data_packages')
      .select('*')
      .order('network')
      .order('size_gb')
    setPackages((data as DataPackage[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId(null)
  }

  const startEdit = (pkg: DataPackage) => {
    setEditingId(pkg.id)
    setForm({
      network: pkg.network,
      size_gb: String(pkg.size_gb),
      price: String(pkg.price),
      validity: pkg.validity || 'Non expiry',
    })
    setMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSave = async () => {
    if (!form.size_gb || !form.price) {
      setMessage('Size and price are required.')
      return
    }

    const sizeGb = Number(form.size_gb)
    const price = Number(form.price)
    if (!Number.isFinite(sizeGb) || sizeGb <= 0 || !Number.isFinite(price) || price < 0) {
      setMessage('Enter a valid size and price.')
      return
    }

    setSaving(true)
    setMessage(null)

    const payload = {
      network: form.network,
      size_gb: sizeGb,
      price,
      validity: form.validity.trim() || 'Non expiry',
    }

    const { error } = editingId
      ? await supabase.from('data_packages').update(payload).eq('id', editingId)
      : await supabase.from('data_packages').insert({ ...payload, active: true })

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(editingId ? 'Package updated successfully.' : 'Package added successfully.')
    resetForm()
    await refresh()
  }

  const toggleActive = async (pkg: DataPackage) => {
    await supabase.from('data_packages').update({ active: !pkg.active }).eq('id', pkg.id)
    await refresh()
  }

  const deletePackage = async (id: string) => {
    if (!confirm('Delete this package?')) return
    if (editingId === id) resetForm()
    await supabase.from('data_packages').delete().eq('id', id)
    await refresh()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Packages"
        description="Create, edit, and manage data packages available via the API."
      />

      <Panel
        title={editingId ? 'Edit Package' : 'Add Package'}
        description={editingId ? 'Update the selected package, then save.' : undefined}
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Network</label>
            <select
              value={form.network}
              onChange={(e) => setForm({ ...form, network: e.target.value })}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            >
              {PACKAGE_NETWORKS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Size (GB)</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={form.size_gb}
              onChange={(e) => setForm({ ...form, size_gb: e.target.value })}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Price (GHS)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Validity</label>
            <input
              value={form.validity}
              onChange={(e) => setForm({ ...form, validity: e.target.value })}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex-1 h-10 rounded-lg bg-red-500 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {editingId ? (
                <>Save</>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Add
                </>
              )}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="h-10 w-10 rounded-lg border border-white/10 grid place-items-center hover:bg-white/5"
                aria-label="Cancel edit"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {message && (
          <p
            className={`text-sm mt-3 ${
              message.includes('success') ? 'text-emerald-400' : 'text-destructive'
            }`}
          >
            {message}
          </p>
        )}
      </Panel>

      <Panel title="All Packages" description={`${packages.length} package(s)`}>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : packages.length === 0 ? (
          <EmptyState title="No packages" description="Add your first data package above." />
        ) : (
          <div className="overflow-x-auto -mx-5 md:-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="px-5 md:px-6 py-3 font-medium">Network</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Size</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Price</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Validity</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Status</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {packages.map((pkg) => (
                  <tr
                    key={pkg.id}
                    className={editingId === pkg.id ? 'bg-red-500/5' : undefined}
                  >
                    <td className="px-5 md:px-6 py-3">{formatNetwork(pkg.network)}</td>
                    <td className="px-5 md:px-6 py-3 font-bold">{pkg.size_gb} GB</td>
                    <td className="px-5 md:px-6 py-3">{formatCurrency(Number(pkg.price))}</td>
                    <td className="px-5 md:px-6 py-3 text-muted-foreground">{pkg.validity}</td>
                    <td className="px-5 md:px-6 py-3">
                      <StatusBadge status={pkg.active ? 'active' : 'inactive'} />
                    </td>
                    <td className="px-5 md:px-6 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(pkg)}
                          className="inline-flex items-center gap-1 text-xs font-bold text-foreground/80 hover:underline"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleActive(pkg)}
                          className="text-xs font-bold text-primary hover:underline"
                        >
                          {pkg.active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deletePackage(pkg.id)}
                          className="text-destructive hover:bg-destructive/10 rounded p-1"
                          aria-label={`Delete ${pkg.size_gb}GB package`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
