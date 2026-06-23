import { CheckCircle2, Download, FileSpreadsheet, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Panel } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { useAdminOrderExports } from '../../hooks/useAdminData'
import { downloadOrdersExcel } from '../../lib/exportOrders'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Order, Profile } from '../../types/database'

async function fetchOrdersForExport(orderIds: string[]) {
  const { data: ordersData } = await supabase
    .from('orders')
    .select('*')
    .in('id', orderIds)
    .order('created_at', { ascending: true })

  const orders = (ordersData as Order[]) ?? []
  const userIds = [...new Set(orders.map((o) => o.user_id))]

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds)

  const profileMap = Object.fromEntries(
    ((profiles as Pick<Profile, 'id' | 'full_name' | 'email'>[]) ?? []).map((p) => [p.id, p]),
  )

  return orders.map((order) => ({
    ...order,
    profile: profileMap[order.user_id],
  }))
}

export default function AdminOrderExportsPanel() {
  const { user } = useAuth()
  const { exports, pendingCount, loading, refresh } = useAdminOrderExports()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const downloadNextBatch = async () => {
    if (!user) return
    setBusy('next')
    setMessage(null)

    const { data, error } = await supabase.rpc('admin_create_order_export', {
      p_admin_id: user.id,
    })

    if (error || !data?.success) {
      setMessage(error?.message ?? data?.error ?? 'Export failed')
      setBusy(null)
      return
    }

    const orderIds = (data.order_ids as string[]) ?? []
    const rows = await fetchOrdersForExport(orderIds)
    downloadOrdersExcel(rows, data.file_label as string)

    setMessage(`Downloaded ${data.order_count} order(s) — ${data.file_label}`)
    setBusy(null)
    await refresh()
  }

  const redownloadBatch = async (downloadId: string, fileLabel: string, orderIds: string[]) => {
    if (!user) return

    const confirmed = window.confirm(
      'This batch was already downloaded. Download the same orders again?',
    )
    if (!confirmed) return

    setBusy(downloadId)
    setMessage(null)

    const rows = await fetchOrdersForExport(orderIds)
    downloadOrdersExcel(rows, fileLabel)

    await supabase.rpc('admin_record_order_redownload', {
      p_admin_id: user.id,
      p_download_id: downloadId,
    })

    setMessage(`Re-downloaded ${rows.length} order(s) — ${fileLabel}`)
    setBusy(null)
    await refresh()
  }

  const nextBatchSize = Math.min(pendingCount, 50)

  return (
    <Panel
      title="Export Orders to Excel"
      description="Each file contains up to 50 orders. Downloaded batches are marked so you don't export the same set twice by mistake."
    >
      <div className="space-y-4">
        {message && (
          <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2">
            {message}
          </p>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div>
            <p className="font-bold">Next export batch</p>
            <p className="text-sm text-muted-foreground mt-1">
              {pendingCount === 0
                ? 'All orders have been exported.'
                : `${nextBatchSize} unexported order(s) ready (${pendingCount} total pending)`}
            </p>
          </div>
          <button
            type="button"
            disabled={pendingCount === 0 || busy !== null}
            onClick={() => void downloadNextBatch()}
            className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-primary text-primary-foreground font-bold disabled:opacity-50 shrink-0"
          >
            {busy === 'next' ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download next batch
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading export history…</p>
        ) : exports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exports yet. Download your first batch above.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider">
              Downloaded batches ({exports.length})
            </p>
            <div className="divide-y divide-white/10 rounded-xl border border-white/10 overflow-hidden">
              {exports.map((exp) => (
                <div
                  key={exp.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-white/[0.02]"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <FileSpreadsheet className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold truncate">{exp.file_label}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {exp.order_count} orders · {formatDate(exp.downloaded_at)}
                        {exp.download_count > 1 && ` · downloaded ${exp.download_count}×`}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400 shrink-0">
                      <CheckCircle2 className="h-3 w-3" />
                      Downloaded
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void redownloadBatch(exp.id, exp.file_label, exp.order_ids)}
                    className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg border border-white/10 text-sm font-medium hover:bg-white/5 disabled:opacity-50 shrink-0"
                  >
                    {busy === exp.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Download again
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
