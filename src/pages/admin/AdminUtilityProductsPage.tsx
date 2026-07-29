import { useEffect, useState } from 'react'
import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { formatCurrency } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { UtilityProduct } from '../../lib/utilityConstants'

const emptyForm = {
  service_type: 'airtime',
  provider_code: '',
  label: '',
  min_amount: '1',
  max_amount: '500',
  markup_percent: '0',
  flat_fee: '0',
  xcel_merchant_id: '',
  xcel_to_acct: '',
  xcel_biller_wallet_num: '',
  xcel_account_name: '',
  bill_sub_type: '',
  xcel_type: '',
  active: true,
  display_order: '0',
}

export default function AdminUtilityProductsPage() {
  const [products, setProducts] = useState<UtilityProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('utility_products')
      .select('*')
      .order('service_type')
      .order('display_order')
    setProducts((data as UtilityProduct[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const startEdit = (p: UtilityProduct) => {
    setEditingId(p.id)
    setForm({
      service_type: p.service_type,
      provider_code: p.provider_code,
      label: p.label,
      min_amount: String(p.min_amount),
      max_amount: String(p.max_amount),
      markup_percent: String(p.markup_percent),
      flat_fee: String(p.flat_fee),
      xcel_merchant_id: p.xcel_merchant_id ?? '',
      xcel_to_acct: p.xcel_to_acct ?? '',
      xcel_biller_wallet_num: p.xcel_biller_wallet_num ?? '',
      xcel_account_name: p.xcel_account_name ?? '',
      bill_sub_type: p.bill_sub_type ?? '',
      xcel_type: p.xcel_type ?? '',
      active: p.active,
      display_order: String(p.display_order),
    })
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    const payload = {
      service_type: form.service_type,
      provider_code: form.provider_code.trim().toUpperCase(),
      label: form.label.trim(),
      min_amount: Number(form.min_amount),
      max_amount: Number(form.max_amount),
      markup_percent: Number(form.markup_percent),
      flat_fee: Number(form.flat_fee),
      xcel_merchant_id: form.xcel_merchant_id.trim() || null,
      xcel_to_acct: form.xcel_to_acct.trim() || null,
      xcel_biller_wallet_num: form.xcel_biller_wallet_num.trim() || null,
      xcel_account_name: form.xcel_account_name.trim() || null,
      bill_sub_type: form.bill_sub_type.trim() || null,
      xcel_type: form.xcel_type.trim() || null,
      active: form.active,
      display_order: Number(form.display_order) || 0,
      updated_at: new Date().toISOString(),
    }

    const { error } = editingId
      ? await supabase.from('utility_products').update(payload).eq('id', editingId)
      : await supabase.from('utility_products').insert(payload)

    setSaving(false)
    if (error) {
      setMessage(error.message)
      return
    }
    setMessage(editingId ? 'Product updated.' : 'Product created.')
    setEditingId(null)
    setForm(emptyForm)
    await refresh()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Utility Products"
        description="Catalog for Airtime, ECG, and TV via Xcel. Fill merchant IDs from your Xcel VAS list."
      />

      {message && <p className="text-sm text-emerald-400">{message}</p>}

      <Panel title={editingId ? 'Edit product' : 'Add product'}>
        <h3 className="text-sm font-medium mb-4">{editingId ? 'Edit product' : 'Add product'}</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {(
            [
              ['service_type', 'Service', 'select'],
              ['provider_code', 'Provider code (MTN, ecg2, DSTV…)', 'text'],
              ['label', 'Label', 'text'],
              ['min_amount', 'Min amount', 'number'],
              ['max_amount', 'Max amount', 'number'],
              ['markup_percent', 'Markup %', 'number'],
              ['flat_fee', 'Flat fee (GHS)', 'number'],
              ['xcel_merchant_id', 'Xcel merchant ID', 'text'],
              ['xcel_to_acct', 'Xcel to_acct', 'text'],
              ['xcel_biller_wallet_num', 'Biller wallet num', 'text'],
              ['xcel_account_name', 'Account name', 'text'],
              ['bill_sub_type', 'bill_sub_type', 'text'],
              ['xcel_type', 'type (topup/electricity/cable)', 'text'],
              ['display_order', 'Display order', 'number'],
            ] as const
          ).map(([key, label, type]) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="text-muted-foreground">{label}</span>
              {key === 'service_type' ? (
                <select
                  value={form.service_type}
                  onChange={(e) => setForm({ ...form, service_type: e.target.value })}
                  className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 outline-none"
                >
                  <option value="airtime">airtime</option>
                  <option value="ecg">ecg</option>
                  <option value="tv">tv</option>
                </select>
              ) : (
                <input
                  type={type}
                  value={String(form[key as keyof typeof form] ?? '')}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className="w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 outline-none"
                />
              )}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm mt-6">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(emptyForm)
              }}
              className="h-10 px-4 rounded-lg border border-white/10 text-sm"
            >
              Cancel
            </button>
          )}
        </div>
      </Panel>

      <Panel title="Catalog">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : products.length === 0 ? (
          <EmptyState title="No utility products" description="Create Airtime / ECG / TV products above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-white/10">
                  <th className="py-2 pr-3">Service</th>
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Range</th>
                  <th className="py-2 pr-3">Markup</th>
                  <th className="py-2 pr-3">Merchant</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b border-white/5">
                    <td className="py-2 pr-3">{p.service_type}</td>
                    <td className="py-2 pr-3">
                      {p.label} ({p.provider_code})
                    </td>
                    <td className="py-2 pr-3">
                      {formatCurrency(p.min_amount)}–{formatCurrency(p.max_amount)}
                    </td>
                    <td className="py-2 pr-3">
                      {p.markup_percent}% + {formatCurrency(p.flat_fee)}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{p.xcel_merchant_id || '—'}</td>
                    <td className="py-2 pr-3">{p.active ? 'Yes' : 'No'}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="text-primary text-xs underline"
                      >
                        Edit
                      </button>
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
