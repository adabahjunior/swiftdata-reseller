import { Clock3, Radio, Timer, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  computePlatformDeliveryStats,
  fetchPlatformDeliveryPace,
  type PlatformDeliveryPace,
} from '../../lib/deliveryLiveStats'
import { formatDate, formatRelativeTime } from '../../lib/format'

const PACE_DOT: Record<string, string> = {
  fast: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]',
  normal: 'bg-primary shadow-[0_0_10px_rgba(255,215,0,0.85)]',
  busy: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]',
  unknown: 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.85)]',
}

const PACE_TEXT: Record<string, string> = {
  fast: 'text-emerald-300',
  normal: 'text-primary',
  busy: 'text-amber-300',
  unknown: 'text-sky-300',
}

export function LiveDeliveryStrip({ loading }: { loading?: boolean }) {
  const [, setTick] = useState(0)
  const [platform, setPlatform] = useState<PlatformDeliveryPace | null>(null)
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 20_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const pace = await fetchPlatformDeliveryPace()
      if (!cancelled) {
        setPlatform(pace)
        setFetching(false)
      }
    }

    void load()
    const id = window.setInterval(() => void load(), 45_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const stats = computePlatformDeliveryStats(platform)
  const lastLabel = stats.lastDeliveredAt
    ? `${formatRelativeTime(stats.lastDeliveredAt)} · ${formatDate(stats.lastDeliveredAt)}`
    : 'No deliveries yet'

  const items = [
    {
      key: 'pace',
      icon: Zap,
      label: 'Site pace',
      value: (
        <>
          <span className={PACE_TEXT[stats.pace]}>{stats.paceLabel}</span>
          {stats.avgMs != null && (
            <span className="text-muted-foreground"> · {stats.avgLabel} avg</span>
          )}
        </>
      ),
    },
    {
      key: 'eta',
      icon: Timer,
      label: 'Queue ETA',
      value: <span className="text-foreground">{stats.etaLabel}</span>,
    },
    {
      key: 'last',
      icon: Clock3,
      label: 'Last delivered',
      value: <span className="text-foreground">{lastLabel}</span>,
    },
  ]

  const busy = loading || fetching

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-primary/35 bg-gradient-to-r from-primary/20 via-[#1a1500] to-emerald-500/15 shadow-[0_0_28px_rgba(255,215,0,0.12)]"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0 live-delivery-shimmer opacity-40" />
      <div className="pointer-events-none absolute -left-8 top-0 h-full w-24 bg-primary/25 blur-2xl" />
      <div className="pointer-events-none absolute -right-8 top-0 h-full w-24 bg-emerald-400/20 blur-2xl" />

      <div className="relative flex items-stretch gap-0 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-2 shrink-0 px-3.5 py-2.5 border-r border-white/10 bg-black/25">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${PACE_DOT[stats.pace]}`}
            />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${PACE_DOT[stats.pace]}`} />
          </span>
          <Radio className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">
            {busy ? 'Sync…' : 'Live'}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center divide-x divide-white/10">
          {items.map((item) => (
            <div
              key={item.key}
              className="flex min-w-[10rem] flex-1 items-center gap-2.5 px-3.5 py-2.5 whitespace-nowrap"
            >
              <item.icon className="h-3.5 w-3.5 shrink-0 text-primary/90" />
              <div className="min-w-0 leading-tight">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/90">
                  {item.label}
                </p>
                <p className="text-sm font-semibold truncate">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
