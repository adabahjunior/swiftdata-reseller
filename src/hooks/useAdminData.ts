import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ApiKey, Notification, Order, Profile, SiteSetting, Transaction } from '../types/database'

export function useAdminStats() {
  const [stats, setStats] = useState({
    users: 0,
    orders: 0,
    revenue: 0,
    pendingOrders: 0,
    packages: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('amount, status'),
      supabase.from('data_packages').select('id', { count: 'exact', head: true }).eq('active', true),
    ]).then(([usersRes, ordersRes, packagesRes]) => {
      const orders = (ordersRes.data ?? []) as Pick<Order, 'amount' | 'status'>[]
      setStats({
        users: usersRes.count ?? 0,
        orders: orders.length,
        revenue: orders
          .filter((o) => o.status === 'completed')
          .reduce((sum, o) => sum + Number(o.amount), 0),
        pendingOrders: orders.filter((o) => o.status === 'pending' || o.status === 'processing').length,
        packages: packagesRes.count ?? 0,
      })
      setLoading(false)
    })
  }, [])

  return { stats, loading }
}

export function useAdminOrders() {
  const [orders, setOrders] = useState<(Order & { profile?: Profile })[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const { data: ordersData } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })

    const { data: profiles } = await supabase.from('profiles').select('id, full_name, email')

    const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))

    setOrders(
      ((ordersData as Order[]) ?? []).map((order) => ({
        ...order,
        profile: profileMap[order.user_id],
      })),
    )
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { orders, loading, refresh }
}

export function useAdminUsers() {
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setUsers((data as Profile[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { users, loading, refresh }
}

export function useAdminNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
    setNotifications((data as Notification[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { notifications, loading, refresh }
}

export function useSiteSettings() {
  const [settings, setSettings] = useState<SiteSetting[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const { data } = await supabase.from('site_settings').select('*').order('key')
    setSettings((data as SiteSetting[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { settings, loading, refresh }
}

export function useAdminUserDetail(userId: string | undefined) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    if (!userId) return
    setLoading(true)
    const [profileRes, ordersRes, txRes, keysRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('api_keys').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ])
    setProfile((profileRes.data as Profile) ?? null)
    setOrders((ordersRes.data as Order[]) ?? [])
    setTransactions((txRes.data as Transaction[]) ?? [])
    setKeys((keysRes.data as ApiKey[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [userId])

  return { profile, orders, transactions, keys, loading, refresh }
}
