import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  AgentCustomer,
  SupportTicket,
  SupportTicketMessage,
} from '../types/database'

export function useSupportTickets() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false })
    setTickets((data as SupportTicket[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const channel = supabase
      .channel('my-support-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => {
        void refresh()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  const createTicket = async (input: {
    subject: string
    body: string
    order_reference?: string
    priority?: SupportTicket['priority']
  }) => {
    const { data: session } = await supabase.auth.getUser()
    const userId = session.user?.id
    if (!userId) return { success: false as const, error: 'Not signed in' }

    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        user_id: userId,
        subject: input.subject.trim(),
        body: input.body.trim(),
        order_reference: input.order_reference?.trim() || null,
        priority: input.priority ?? 'normal',
      })
      .select('*')
      .single()

    if (error) return { success: false as const, error: error.message }
    await refresh()
    return { success: true as const, ticket: data as SupportTicket }
  }

  const addMessage = async (ticketId: string, body: string) => {
    const { data: session } = await supabase.auth.getUser()
    const userId = session.user?.id
    if (!userId) return { success: false as const, error: 'Not signed in' }

    const { error } = await supabase.from('support_ticket_messages').insert({
      ticket_id: ticketId,
      author_id: userId,
      body: body.trim(),
      is_admin_reply: false,
    })
    if (error) return { success: false as const, error: error.message }
    return { success: true as const }
  }

  return { tickets, loading, refresh, createTicket, addMessage }
}

export function useTicketMessages(ticketId: string | null) {
  const [messages, setMessages] = useState<SupportTicketMessage[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!ticketId) {
      setMessages([])
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('support_ticket_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
    setMessages((data as SupportTicketMessage[]) ?? [])
    setLoading(false)
  }, [ticketId])

  useEffect(() => {
    void refresh()
    if (!ticketId) return
    const channel = supabase
      .channel(`ticket-msgs-${ticketId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_ticket_messages',
          filter: `ticket_id=eq.${ticketId}`,
        },
        () => {
          void refresh()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [ticketId, refresh])

  return { messages, loading, refresh }
}

export function useAgentCustomers() {
  const [customers, setCustomers] = useState<AgentCustomer[]>([])
  const [returningCount, setReturningCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('get_agent_customers')
    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? data?.error ?? 'Failed to load customers')
      setCustomers([])
      setLoading(false)
      return
    }
    setCustomers((data.customers as AgentCustomer[]) ?? [])
    setReturningCount(Number(data.returning_count ?? 0))
    setTotalCount(Number(data.total_count ?? 0))
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { customers, returningCount, totalCount, loading, error, refresh }
}

export type AgentAnalytics = {
  days: number
  since: string
  wallet_balance: number
  orders: {
    total: number
    completed: number
    pending: number
    failed: number
    revenue: number
    spend: number
    period_orders: number
    period_revenue: number
  }
  transactions: {
    credits: number
    debits: number
    period_credits: number
    period_debits: number
    tx_count: number
  }
  daily: Array<{
    day: string
    orders: number
    revenue: number
    completed: number
    failed: number
  }>
  networks: Array<{ network: string; orders: number; revenue: number }>
  customers: {
    unique_phones: number
    returning_phones: number
    new_phones: number
  }
}

export function useAgentAnalytics(days = 30) {
  const [analytics, setAnalytics] = useState<AgentAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('get_agent_analytics', {
      p_days: days,
    })
    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? data?.error ?? 'Failed to load analytics')
      setAnalytics(null)
      setLoading(false)
      return
    }
    setAnalytics(data as AgentAnalytics)
    setError(null)
    setLoading(false)
  }, [days])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { analytics, loading, error, refresh }
}
