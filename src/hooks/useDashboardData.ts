import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ApiKey, ApiLog, DataPackage, Order, Transaction } from '../types/database'

function subscribeOrders(onChange: () => void) {
  const channel = supabase
    .channel('orders-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      onChange()
    })
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}

export function useOrders(limit?: number) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    await supabase.rpc('auto_deliver_pending_orders')

    const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false })
    setOrders((data as Order[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    return subscribeOrders(() => {
      void refresh()
    })
  }, [refresh])

  const displayed = limit ? orders.slice(0, limit) : orders

  return { orders: displayed, allOrders: orders, loading, refresh }
}

export function usePackages() {
  const [packages, setPackages] = useState<DataPackage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('data_packages')
      .select('*')
      .eq('active', true)
      .order('network')
      .order('size_gb')
      .then(({ data }) => {
        setPackages((data as DataPackage[]) ?? [])
        setLoading(false)
      })
  }, [])

  return { packages, loading }
}

export function useApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const { data } = await supabase
      .from('api_keys')
      .select('*')
      .order('created_at', { ascending: false })
    setKeys((data as ApiKey[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { keys, loading, refresh }
}

export function useTransactions(limit?: number) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let query = supabase.from('transactions').select('*').order('created_at', { ascending: false })
    if (limit) query = query.limit(limit)

    query.then(({ data }) => {
      setTransactions((data as Transaction[]) ?? [])
      setLoading(false)
    })
  }, [limit])

  return { transactions, loading }
}

export function useApiLogs(limit?: number) {
  const [logs, setLogs] = useState<ApiLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let query = supabase.from('api_logs').select('*').order('created_at', { ascending: false })
    if (limit) query = query.limit(limit)

    query.then(({ data }) => {
      setLogs((data as ApiLog[]) ?? [])
      setLoading(false)
    })
  }, [limit])

  return { logs, loading }
}
