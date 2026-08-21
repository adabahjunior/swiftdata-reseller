import { supabase } from './supabase'

export type DeliveryPace = 'fast' | 'normal' | 'busy' | 'unknown'

export type DeliveryLiveStats = {
  pace: DeliveryPace
  paceLabel: string
  avgMs: number | null
  avgLabel: string
  pendingCount: number
  etaLabel: string
  lastDeliveredAt: string | null
  sampleSize: number
}

export type PlatformDeliveryPace = {
  avgMs: number | null
  sampleSize: number
  pendingCount: number
  lastDeliveredAt: string | null
}

const MIN_SAMPLES = 2

export function formatDurationShort(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 45) return 'under 1 min'
  const min = Math.round(sec / 60)
  if (min < 60) return `~${min} min`
  const hours = Math.floor(min / 60)
  const rem = min % 60
  if (rem === 0) return `~${hours}h`
  return `~${hours}h ${rem}m`
}

function paceFromAvg(avgMs: number | null): { pace: DeliveryPace; paceLabel: string } {
  if (avgMs == null) return { pace: 'unknown', paceLabel: 'Warming up' }
  if (avgMs <= 2 * 60_000) return { pace: 'fast', paceLabel: 'Very fast' }
  if (avgMs <= 8 * 60_000) return { pace: 'fast', paceLabel: 'Fast' }
  if (avgMs <= 20 * 60_000) return { pace: 'normal', paceLabel: 'Steady' }
  return { pace: 'busy', paceLabel: 'Busy' }
}

export async function fetchPlatformDeliveryPace(): Promise<PlatformDeliveryPace | null> {
  const { data, error } = await supabase.rpc('get_live_delivery_pace')
  if (error || !data?.success) return null

  const avgSeconds = typeof data.avg_seconds === 'number' ? data.avg_seconds : null
  return {
    avgMs: avgSeconds != null ? avgSeconds * 1000 : null,
    sampleSize: typeof data.sample_size === 'number' ? data.sample_size : 0,
    pendingCount: typeof data.pending_count === 'number' ? data.pending_count : 0,
    lastDeliveredAt: typeof data.last_delivered_at === 'string' ? data.last_delivered_at : null,
  }
}

/** Site-wide delivery pace from all platform orders (not per-user). */
export function computePlatformDeliveryStats(
  platform: PlatformDeliveryPace | null,
): DeliveryLiveStats {
  const avgMs =
    platform?.avgMs != null && (platform.sampleSize ?? 0) >= MIN_SAMPLES ? platform.avgMs : null
  const sampleSize = platform?.sampleSize ?? 0
  const pendingCount = platform?.pendingCount ?? 0
  const { pace, paceLabel } = paceFromAvg(avgMs)

  let etaLabel = 'Queue clear'
  if (pendingCount > 0) {
    if (avgMs == null) {
      etaLabel = `${pendingCount} in queue · typically a few min`
    } else {
      // Parallel-ish queue: assume ~3 concurrent deliveries
      const etaMs = avgMs * Math.ceil(pendingCount / 3)
      if (etaMs <= 90_000) etaLabel = `${pendingCount} in queue · any moment`
      else etaLabel = `${pendingCount} in queue · ETA ${formatDurationShort(etaMs)}`
    }
  } else if (avgMs != null) {
    etaLabel = `Typical wait ${formatDurationShort(avgMs)}`
  }

  return {
    pace,
    paceLabel,
    avgMs,
    avgLabel: avgMs != null ? formatDurationShort(avgMs) : '—',
    pendingCount,
    etaLabel,
    lastDeliveredAt: platform?.lastDeliveredAt ?? null,
    sampleSize,
  }
}
