const FULFILL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fulfill-orders`

/** Trigger provider fulfillment queue (fire-and-forget). */
export function triggerProviderFulfillment() {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!FULFILL_URL || !anon) return

  void fetch(`${FULFILL_URL}/process`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
  }).catch(() => {
    /* background job */
  })
}

/** Submit a single order to the data provider after placement. */
export async function triggerOrderFulfillment(orderId: string) {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!orderId || !FULFILL_URL || !anon) return

  await fetch(`${FULFILL_URL}/order/${orderId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
  })
}
