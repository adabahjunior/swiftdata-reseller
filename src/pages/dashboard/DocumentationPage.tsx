import { Check, Copy, Download } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../components/dashboard/ui'
import {
  DOC_ENDPOINTS,
  DOC_ERROR_CODES,
  buildApiDocsText,
  downloadApiDocsPdf,
} from '../../lib/apiDocumentation'
import { API_BASE_URL, API_NETWORKS } from '../../lib/constants'

export default function DocumentationPage() {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const copyDocs = async () => {
    setActionError(null)
    try {
      await navigator.clipboard.writeText(buildApiDocsText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setActionError('Could not copy to clipboard. Try downloading the PDF instead.')
    }
  }

  const downloadPdf = async () => {
    setDownloading(true)
    setActionError(null)
    try {
      await downloadApiDocsPdf()
    } catch {
      setActionError('Could not generate PDF. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="API Documentation"
        description="SwiftData Reseller REST API — purchase data bundles programmatically across all Ghana networks."
        action={
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void copyDocs()}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-white/10 bg-secondary/50 text-sm font-bold hover:bg-secondary transition-colors"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy docs'}
            </button>
            <button
              type="button"
              onClick={() => void downloadPdf()}
              disabled={downloading}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
          </div>
        }
      />

      {actionError && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
          {actionError}
        </p>
      )}
      {copied && !actionError && (
        <p className="text-sm text-emerald-400">Full API documentation copied to clipboard.</p>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6 space-y-4">
        <h2 className="font-display font-bold text-lg">Base URL</h2>
        <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto text-primary">
          {API_BASE_URL}
        </pre>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6 space-y-4">
        <h2 className="font-display font-bold text-lg">Authentication</h2>
        <p className="text-sm text-muted-foreground">
          Every request requires your API key in the{' '}
          <code className="text-xs bg-secondary px-1.5 py-0.5 rounded">Authorization</code> header.
          Generate a key from <strong>My API</strong> in your dashboard.
        </p>
        <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto">
          {`Authorization: Bearer sk_live_your_api_key
Content-Type: application/json`}
        </pre>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6 space-y-4">
        <h2 className="font-display font-bold text-lg">Supported Networks</h2>
        <p className="text-sm text-muted-foreground">
          Use these <code className="text-xs bg-secondary px-1 rounded">network</code> IDs in
          package and order responses:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-muted-foreground text-left">
                <th className="py-2 pr-4 font-medium">Network ID</th>
                <th className="py-2 font-medium">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {API_NETWORKS.map((n) => (
                <tr key={n.id}>
                  <td className="py-2 pr-4 font-mono text-primary">{n.id}</td>
                  <td className="py-2">{n.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Note: Yello packages are stored internally as MTN. API responses use{' '}
          <code className="text-xs bg-secondary px-1 rounded">yello</code>; your dashboard orders
          show <code className="text-xs bg-secondary px-1 rounded">mtn</code>.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6 space-y-4">
        <h2 className="font-display font-bold text-lg">Quick Start</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>
            Top up via MoMo — see <strong>My API Balance</strong> for instructions and your 5-digit
            code
          </li>
          <li>
            Generate an API key from <strong>My API</strong>
          </li>
          <li>
            <code className="text-xs bg-secondary px-1 rounded">GET /v1/packages</code> — list
            available network + size_gb bundles
          </li>
          <li>
            <code className="text-xs bg-secondary px-1 rounded">POST /v1/buy-data</code> — purchase
            data
          </li>
          <li>
            <code className="text-xs bg-secondary px-1 rounded">GET /v1/orders/{'{reference}'}</code>{' '}
            — confirm delivery
          </li>
        </ol>
      </div>

      <div className="space-y-4">
        <h2 className="font-display font-bold text-lg">Endpoints</h2>
        {DOC_ENDPOINTS.map((ep) => (
          <div
            key={ep.path + ep.method}
            className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 bg-white/[0.02] flex-wrap">
              <span
                className={`text-[10px] font-black uppercase px-2 py-1 rounded ${
                  ep.method === 'GET'
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'bg-primary/15 text-primary'
                }`}
              >
                {ep.method}
              </span>
              <code className="text-sm font-mono">
                {API_BASE_URL}
                {ep.path}
              </code>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <h3 className="font-bold">{ep.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{ep.description}</p>
              </div>
              {ep.body && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Request Body</p>
                  <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto text-muted-foreground">
                    {ep.body}
                  </pre>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Example Response</p>
                <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto text-emerald-400/80">
                  {ep.response}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6 space-y-3">
        <h2 className="font-display font-bold text-lg">Error Codes</h2>
        <div className="space-y-2">
          {DOC_ERROR_CODES.map((e) => (
            <div key={e.code} className="flex gap-3 text-sm">
              <span className="font-mono font-bold text-red-400 w-10">{e.code}</span>
              <span className="text-muted-foreground">{e.meaning}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6 space-y-3">
        <h2 className="font-display font-bold text-lg">Order Status Values</h2>
        <div className="flex flex-wrap gap-2">
          {['pending', 'processing', 'completed', 'failed'].map((status) => (
            <span
              key={status}
              className="rounded-full border border-white/10 bg-secondary/50 px-3 py-1 text-xs font-mono capitalize"
            >
              {status}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6 space-y-4">
        <h2 className="font-display font-bold text-lg">Examples</h2>

        <div>
          <p className="text-sm font-medium mb-2">Check balance</p>
          <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto text-muted-foreground">
{`curl -X GET "${API_BASE_URL}/v1/balance" \\
  -H "Authorization: Bearer sk_live_your_api_key"`}
          </pre>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Buy Yello 1GB</p>
          <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto text-muted-foreground">
{`curl -X POST "${API_BASE_URL}/v1/buy-data" \\
  -H "Authorization: Bearer sk_live_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "0241234567",
    "network": "yello",
    "size_gb": 1
  }'`}
          </pre>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Buy AirtelTigo iShare 2GB</p>
          <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto text-muted-foreground">
{`curl -X POST "${API_BASE_URL}/v1/buy-data" \\
  -H "Authorization: Bearer sk_live_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "0271234567",
    "network": "at_ishare",
    "size_gb": 2
  }'`}
          </pre>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Poll order status</p>
          <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-xl p-4 overflow-x-auto text-muted-foreground">
{`curl -X GET "${API_BASE_URL}/v1/orders/ORD-ABC123XYZ" \\
  -H "Authorization: Bearer sk_live_your_api_key"`}
          </pre>
        </div>
      </div>
    </div>
  )
}
