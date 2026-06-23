import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/dashboard/ui'
import { PACKAGE_NETWORKS } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../lib/format'
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

  const handleAdd = async () => {
    if (!form.size_gb || !form.price) return
    setSaving(true)
    setMessage(null)

    const { error } = await supabase.from('data_packages').insert({
      network: form.network,
      size_gb: Number(form.size_gb),
      price: Number(form.price),
      validity: form.validity,
      active: true,
    })

    setSaving(false)
    if (error) {
      setMessage(error.message)
      return
    }

    setForm(emptyForm)
    setMessage('Package added successfully.')
    await refresh()
  }

  const toggleActive = async (pkg: DataPackage) => {
    await supabase.from('data_packages').update({ active: !pkg.active }).eq('id', pkg.id)
    await refresh()
  }

  const deletePackage = async (id: string) => {
    if (!confirm('Delete this package?')) return
    await supabase.from('data_packages').delete().eq('id', id)
    await refresh()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Packages"
        description="Create and manage data packages available via the API."
      />

      <Panel title="Add Package">
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
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving}
            className="h-10 rounded-lg bg-red-500 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
        {message && (
          <p className={`text-sm mt-3 ${message.includes('success') ? 'text-emerald-400' : 'text-destructive'}`}>
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
                  <tr key={pkg.id}>
                    <td className="px-5 md:px-6 py-3">{PACKAGE_NETWORKS.find((n) => n.id === pkg.network)?.label ?? pkg.network}</td>
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
                          onClick={() => toggleActive(pkg)}
                          className="text-xs font-bold text-primary hover:underline"
                        >
                          {pkg.active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePackage(pkg.id)}
                          className="text-destructive hover:bg-destructive/10 rounded p-1"
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
