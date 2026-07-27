const SMS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`

/** Drain pending SMS outbox via TXTConnect (fire-and-forget). */
export function triggerSmsDispatch() {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!SMS_URL || !anon) return

  void fetch(`${SMS_URL}/process`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
  }).catch(() => {
    /* background */
  })
}
