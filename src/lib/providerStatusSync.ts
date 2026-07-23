const SYNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-provider-status`

/** Poll provider APIs and update order statuses (background). */
export function triggerProviderStatusSync() {
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!SYNC_URL || !anon) return

  void fetch(`${SYNC_URL}/process`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
  }).catch(() => {
    /* background */
  })
}

export function providerWebhookUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL
  if (!base) return ''
  return `${base}/functions/v1/sync-provider-status/provider-webhook/datahub`
}

/** Ghana local 0XXXXXXXXX → digits for wa.me (233...) */
export function whatsappLink(phone: string, text?: string): string {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `233${digits.slice(1)}`
  else if (!digits.startsWith('233')) digits = `233${digits}`
  const base = `https://wa.me/${digits}`
  if (!text) return base
  return `${base}?text=${encodeURIComponent(text)}`
}
