import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const TXTCONNECT_URL = 'https://api.txtconnect.net/dev/api/sms/send'
const TXTCONNECT_BALANCE_URL = 'https://api.txtconnect.net/dev/api/sms/checkbalance'
const SEND_CONCURRENCY = 5

const GSM_CHARS =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€'

function isGsmText(text: string) {
  for (const ch of text) if (!GSM_CHARS.includes(ch)) return false
  return true
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendTxtConnectSms(opts: {
  apiKey: string
  to: string
  from: string
  unicode: string
  sms: string
}) {
  try {
    const res = await fetch(TXTCONNECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        to: opts.to,
        from: opts.from,
        unicode: opts.unicode,
        sms: opts.sms,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const body = await res.json().catch(() => ({}))
    const ok =
      res.ok &&
      body?.data?.in_error !== true &&
      String(body?.data?.status_code ?? body?.status_code ?? '') !== '001'
    return { ok, body, status: res.status }
  } catch (e) {
    // Not retried: the message may have gone out before the connection dropped.
    return { ok: false, body: { message: `Network error: ${(e as Error).message}` }, status: 0 }
  }
}

async function isAdminRequest(supabase: ReturnType<typeof createClient>, req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!token) return false
  const { data } = await supabase.auth.getUser(token)
  if (!data.user) return false
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', data.user.id)
    .maybeSingle()
  return Boolean(profile?.is_admin)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const url = new URL(req.url)
  let path = url.pathname
  const idx = path.indexOf('/send-sms')
  if (idx >= 0) path = path.slice(idx + '/send-sms'.length) || '/'

  try {
    const { data: settings } = await supabase.from('site_settings').select('key, value')
    const map = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))
    const apiKey = map.sms_api_key?.trim() || Deno.env.get('TXTCONNECT_API_KEY')?.trim() || ''
    const sender = map.sms_sender_id?.trim() || 'swiftupdate'

    if (req.method === 'POST' && (path === '/' || path === '/process')) {
      if (map.sms_enabled === 'false') {
        return json({ success: true, processed: 0, message: 'SMS disabled' })
      }
      if (!apiKey) {
        return json({ success: false, error: 'SMS API key not configured' }, 500)
      }

      const forceUnicode = map.sms_unicode?.trim() === '1'
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 30), 100)

      const { data: rows, error } = await supabase.rpc('get_pending_sms_outbox', {
        p_limit: limit,
      })

      if (error) {
        return json({ success: false, error: error.message }, 500)
      }

      const queue = [...((rows ?? []) as Array<{ id: string; phone: string; message: string }>)]
      const results: Array<{ id: string; success: boolean; messageId?: unknown; error?: string }> = []

      const worker = async () => {
        while (queue.length > 0) {
          const row = queue.shift()!
          const sent = await sendTxtConnectSms({
            apiKey,
            to: row.phone,
            from: sender,
            unicode: forceUnicode || !isGsmText(row.message) ? '1' : '0',
            sms: row.message,
          })

          if (sent.ok) {
            await supabase
              .from('sms_outbox')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                provider_message_id: String(sent.body?.messageId ?? sent.body?.data?.data?.messageId ?? ''),
                error: null,
              })
              .eq('id', row.id)
            results.push({ id: row.id, success: true, messageId: sent.body?.messageId })
          } else {
            const errMsg = String(
              sent.body?.data?.reason ??
                sent.body?.msg ??
                sent.body?.message ??
                `TXTConnect error (${sent.status})`,
            )
            await supabase
              .from('sms_outbox')
              .update({
                status: 'failed',
                error: errMsg,
                sent_at: new Date().toISOString(),
              })
              .eq('id', row.id)
            results.push({ id: row.id, success: false, error: errMsg })
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, worker))

      return json({
        success: true,
        processed: results.length,
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
      })
    }

    if (req.method === 'GET' && path === '/balance') {
      if (!(await isAdminRequest(supabase, req))) {
        return json({ success: false, error: 'Admin only' }, 403)
      }
      if (!apiKey) return json({ success: false, error: 'SMS API key not configured' }, 500)
      const res = await fetch(TXTCONNECT_BALANCE_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      const body = await res.json().catch(() => ({}))
      const units = body?.data?.data?.sms
      return json({
        success: res.ok && units !== undefined,
        units: units ?? null,
        sender_id: sender,
        sms_enabled: map.sms_enabled !== 'false',
        error: res.ok ? undefined : String(body?.data?.reason ?? body?.message ?? `TXTConnect error (${res.status})`),
      })
    }

    if (req.method === 'GET' && path === '/health') {
      return json({
        success: true,
        provider: 'TXTConnect',
        endpoint: TXTCONNECT_URL,
      })
    }

    return json({
      success: true,
      endpoints: {
        'POST /process': 'Send pending SMS from outbox via TXTConnect',
        'GET /balance': 'TXTConnect SMS units left (admin only)',
        'GET /health': 'Health check',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
