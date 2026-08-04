import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

export type SkplugRefundOrder = {
  order_id: string
  network: string
  recipient: string
  gb_size: number
  price_paid: number
  amount_owed: number
  status: string
  created_at: string | null
  paid: boolean | null
  bucket: string
  local_order: {
    id: string
    reference: string
    user_id: string
    status: string
    amount: number
    order_source: string | null
    provider_status: string | null
    provider_error: string | null
    created_at: string
    user: { id: string; full_name: string | null; email: string | null } | null
  } | null
}

export type SkplugRefundBucket = {
  count: number
  total: number
  orders: SkplugRefundOrder[]
}

export type SkplugRefundSummary = {
  success: boolean
  provider?: string
  scope?: 'admin' | 'user'
  fetched_at?: string
  waiting: SkplugRefundBucket
  refunded: SkplugRefundBucket
  refund_requested: SkplugRefundBucket
  totals: { count: number; amount_owed: number }
  error?: string
}

const EMPTY: SkplugRefundSummary = {
  success: true,
  waiting: { count: 0, total: 0, orders: [] },
  refunded: { count: 0, total: 0, orders: [] },
  refund_requested: { count: 0, total: 0, orders: [] },
  totals: { count: 0, amount_owed: 0 },
}

export function useSkplugRefunds() {
  const { session } = useAuth()
  const [data, setData] = useState<SkplugRefundSummary>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!session?.access_token) {
      setError('Not signed in')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const base = import.meta.env.VITE_SUPABASE_URL
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
    try {
      const res = await fetch(`${base}/functions/v1/skplug-refunds`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: anon,
        },
      })
      const body = (await res.json().catch(() => ({}))) as SkplugRefundSummary
      if (!res.ok || !body.success) {
        setError(body.error ?? `Failed to load refunds (${res.status})`)
        setData(EMPTY)
      } else {
        setData(body)
      }
    } catch (e) {
      setError((e as Error).message)
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
