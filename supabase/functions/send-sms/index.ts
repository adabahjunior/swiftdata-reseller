import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const TXTCONNECT_URL = 'https://api.txtconnect.net/dev/api/sms/send'

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
  })
  const body = await res.json().catch(() => ({}))
  const ok =
    res.ok &&
    body?.data?.in_error !== true &&
    String(body?.data?.status_code ?? body?.status_code ?? '') !== '001'
  return { ok, body, status: res.status }
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
    if (req.method === 'POST' && (path === '/' || path === '/process')) {
      const { data: settings } = await supabase.from('site_settings').select('key, value')
      const map = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]))

      if (map.sms_enabled === 'false') {
        return json({ success: true, processed: 0, message: 'SMS disabled' })
      }

      const apiKey =
        map.sms_api_key?.trim() || Deno.env.get('TXTCONNECT_API_KEY')?.trim() || ''
      if (!apiKey) {
        return json({ success: false, error: 'SMS API key not configured' }, 500)
      }

      const sender = map.sms_sender_id?.trim() || 'OrderInfo'
      const unicode = map.sms_unicode?.trim() || '0'
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 30), 100)

      const { data: rows, error } = await supabase.rpc('get_pending_sms_outbox', {
        p_limit: limit,
      })

      if (error) {
        return json({ success: false, error: error.message }, 500)
      }

      const results = []
      for (const row of rows ?? []) {
        const sent = await sendTxtConnectSms({
          apiKey,
          to: row.phone,
          from: sender,
          unicode,
          sms: row.message,
        })

        if (sent.ok) {
          await supabase
            .from('sms_outbox')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              provider_message_id: String(sent.body?.messageId ?? ''),
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

      return json({
        success: true,
        processed: results.length,
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
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
        'GET /health': 'Health check',
      },
    })
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 500)
  }
})
