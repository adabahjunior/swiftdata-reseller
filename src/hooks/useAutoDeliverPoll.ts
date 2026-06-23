import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

const POLL_MS = 15_000

/** Runs auto-deliver RPC so pending orders flip to delivered on schedule. */
export function useAutoDeliverPoll(enabled = true) {
  useEffect(() => {
    if (!enabled) return

    const run = () => {
      void supabase.rpc('auto_deliver_pending_orders')
    }

    run()
    const id = window.setInterval(run, POLL_MS)
    return () => window.clearInterval(id)
  }, [enabled])
}
