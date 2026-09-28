import { useState } from 'react'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { OrderProviderAttempt } from '../../types/database'

const OUTCOME_STYLE: Record<OrderProviderAttempt['outcome'], { label: string; tone: string }> = {
  submitting: { label: 'Sending', tone: 'text-amber-400' },
  accepted: { label: 'Accepted', tone: 'text-emerald-400' },
  rejected: { label: 'Rejected', tone: 'text-red-400' },
  uncertain: { label: 'Unclear', tone: 'text-orange-400' },
  failed_later: { label: 'Failed later', tone: 'text-red-400' },
}

export function ProviderRouteHistory({ orderId, attempts }: { orderId: string; attempts: number }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<OrderProviderAttempt[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || rows) return
    setLoading(true)
    const { data } = await supabase
      .from('order_provider_attempts')
      .select('*')
      .eq('order_id', orderId)
      .order('route_round', { ascending: true })
      .order('attempt_no', { ascending: true })
    setRows((data as OrderProviderAttempt[]) ?? [])
    setLoading(false)
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => void toggle()}
        className="text-[10px] font-medium text-sky-400 hover:underline"
      >
        {open ? 'Hide routing' : `Routed ${attempts}×`}
      </button>
      {open && (
        <div className="mt-1 space-y-1 max-w-[220px]">
          {loading && <p className="text-[10px] text-muted-foreground">Loading…</p>}
          {rows?.map((row) => {
            const style = OUTCOME_STYLE[row.outcome]
            return (
              <div key={row.id} className="rounded border border-white/10 bg-black/20 px-2 py-1">
                <p className="text-[10px]">
                  <span className="text-muted-foreground">
                    {row.route_round > 0 ? `R${row.route_round + 1} · ` : ''}#{row.attempt_no}
                  </span>{' '}
                  <span className="font-medium">{row.provider_name}</span>{' '}
                  <span className={style.tone}>{style.label}</span>
                </p>
                {row.error && (
                  <p className="text-[10px] text-muted-foreground truncate" title={row.error}>
                    {row.error}
                  </p>
                )}
                <p className="text-[9px] text-muted-foreground">{formatDate(row.created_at)}</p>
              </div>
            )
          })}
          {rows && rows.length === 0 && (
            <p className="text-[10px] text-muted-foreground">No routing history recorded.</p>
          )}
        </div>
      )}
    </div>
  )
}
