import { API_BASE_URL, API_NETWORKS } from '../../lib/constants'

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/v1/health',
    title: 'Health Check',
    description: 'Returns API status and supported network IDs. No balance required.',
    response: `{
  "success": true,
  "status": "operational",
  "timestamp": "2026-06-23T12:00:00.000Z",
  "networks": ["yello", "at_ishare", "at_bigtime", "telecel"]
}`,
  },
  {
    method: 'GET',
    path: '/v1/balance',
    title: 'Get Balance',
    description: 'Returns your current API wallet balance in GHS.',
    response: `{
  "success": true,
  "balance": 150.00,
  "currency": "GHS"
}`,
  },
  {
    method: 'GET',
    path: '/v1/packages',
    title: 'List Packages',
    description: 'Returns all active data packages with network IDs and labels.',
    response: `{
  "success": true,
  "networks": [
    { "id": "yello", "label": "Yello" },
    { "id": "at_ishare", "label": "AirtelTigo iShare" },
    { "id": "at_bigtime", "label": "AirtelTigo Bigtime" },
    { "id": "telecel", "label": "Telecel" }
  ],
  "packages": [
    {
      "network": "yello",
      "network_label": "Yello",
      "size_gb": 1,
      "price": 4.50,
      "validity": "Non expiry"
    }
  ]
}`,
  },
  {
    method: 'POST',
    path: '/v1/buy-data',
    title: 'Buy Data',
    description:
      'Purchase a data bundle for a Ghana phone number. Deducts from your API balance instantly.',
    body: `{
  "phone": "0241234567",
  "network": "yello",
  "size_gb": 1,
  "reference": "optional-custom-ref"
}`,
    response: `{
  "success": true,
  "order": {
    "reference": "ORD-ABC123XYZ",
    "phone": "0241234567",
    "network": "yello",
    "network_label": "Yello",
    "size_gb": 1,
    "amount": 4.50,
    "status": "completed"
  }
}`,
  },
  {
    method: 'GET',
    path: '/v1/orders',
    title: 'List Orders',
    description: 'Returns your API orders. Supports ?limit=50&offset=0 query params.',
    response: `{
  "success": true,
  "orders": [
    {
      "reference": "ORD-ABC123",
      "phone": "0241234567",
      "network": "at_ishare",
      "network_label": "AirtelTigo iShare",
      "size_gb": 2,
      "amount": 7.50,
      "status": "completed",
      "created_at": "2026-06-23T12:00:00.000Z"
    }
  ]
}`,
  },
  {
    method: 'GET',
    path: '/v1/orders/{reference}',
    title: 'Get Order',
    description: 'Get a single order by its reference. Poll until status is completed or failed.',
    response: `{
  "success": true,
  "order": {
    "reference": "ORD-ABC123",
    "phone": "0241234567",
    "network": "telecel",
    "network_label": "Telecel",
    "size_gb": 1,
    "amount": 4.20,
    "status": "completed"
  }
}`,
  },
]

const ERROR_CODES = [
  { code: 401, meaning: 'Missing or invalid API key' },
  { code: 400, meaning: 'Bad request — invalid phone, missing network/size_gb, insufficient balance' },
  { code: 404, meaning: 'Order or endpoint not found' },
  { code: 500, meaning: 'Internal server error' },
]

export default function DocumentationPage() {
  return (
    <div className="space-y-6 md:space-y-8">
      <div>
        <h1 className="font-display font-bold text-2xl md:text-3xl">API Documentation</h1>
        <p className="text-muted-foreground mt-1 text-sm md:text-base">
          SwiftData Reseller REST API — purchase data bundles programmatically across all Ghana
          networks.
        </p>
      </div>

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
          <li>Top up via MoMo — see <strong>My API Balance</strong> for instructions and your 5-digit code</li>
          <li>Generate an API key from <strong>My API</strong></li>
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
        {ENDPOINTS.map((ep) => (
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
              <code className="text-sm font-mono">{API_BASE_URL}{ep.path}</code>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <h3 className="font-bold">{ep.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{ep.description}</p>
              </div>
              {'body' in ep && ep.body && (
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
          {ERROR_CODES.map((e) => (
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
