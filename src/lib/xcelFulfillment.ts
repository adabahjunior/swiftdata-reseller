const XCEL_FULFILL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fulfill-xcel-orders`

/** Trigger Xcel utility fulfillment queue (fire-and-forget). */
export function triggerXcelFulfillment() {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!XCEL_FULFILL_URL || !anon) return

  void fetch(`${XCEL_FULFILL_URL}/process`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
  }).catch(() => {
    /* background job */
  })
}

/** Submit a single utility order to Xcel after placement. */
export async function triggerXcelOrderFulfillment(orderId: string) {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!orderId || !XCEL_FULFILL_URL || !anon) return

  await fetch(`${XCEL_FULFILL_URL}/order/${orderId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
  })
}
