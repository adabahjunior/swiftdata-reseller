import { API_BASE_URL, API_NETWORKS } from './constants'

export type DocEndpoint = {
  method: string
  path: string
  title: string
  description: string
  body?: string
  response: string
}

export const DOC_ENDPOINTS: DocEndpoint[] = [
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

export const DOC_ERROR_CODES = [
  { code: 401, meaning: 'Missing or invalid API key' },
  { code: 400, meaning: 'Bad request — invalid phone, missing network/size_gb, insufficient balance' },
  { code: 404, meaning: 'Order or endpoint not found' },
  { code: 500, meaning: 'Internal server error' },
]

/** Full API docs as plain text (for clipboard copy). */
export function buildApiDocsText(): string {
  const networks = API_NETWORKS.map((n) => `  ${n.id.padEnd(14)} ${n.label}`).join('\n')

  const endpoints = DOC_ENDPOINTS.map((ep) => {
    const parts = [
      `${ep.method} ${API_BASE_URL}${ep.path}`,
      ep.title,
      ep.description,
    ]
    if (ep.body) {
      parts.push('', 'Request Body:', ep.body)
    }
    parts.push('', 'Example Response:', ep.response)
    return parts.join('\n')
  }).join('\n\n' + '─'.repeat(48) + '\n\n')

  const errors = DOC_ERROR_CODES.map((e) => `  ${e.code}  ${e.meaning}`).join('\n')

  return `SwiftData Reseller — API Documentation
========================================

Base URL
--------
${API_BASE_URL}

Authentication
--------------
Every request requires your API key in the Authorization header.
Generate a key from My API in your dashboard.

  Authorization: Bearer sk_live_your_api_key
  Content-Type: application/json

Supported Networks
------------------
Network ID      Label
${networks}

Note: Yello packages are stored internally as MTN. API responses use "yello";
dashboard orders show "mtn".

Quick Start
-----------
1. Top up via MoMo — see My API Balance for instructions and your 5-digit code
2. Generate an API key from My API
3. GET /v1/packages — list available network + size_gb bundles
4. POST /v1/buy-data — purchase data
5. GET /v1/orders/{reference} — confirm delivery

Endpoints
---------
${endpoints}

Error Codes
-----------
${errors}

Order Status Values
-------------------
  pending, processing, completed, failed

Examples
--------
Check balance:
  curl -X GET "${API_BASE_URL}/v1/balance" \\
    -H "Authorization: Bearer sk_live_your_api_key"

Buy Yello 1GB:
  curl -X POST "${API_BASE_URL}/v1/buy-data" \\
    -H "Authorization: Bearer sk_live_your_api_key" \\
    -H "Content-Type: application/json" \\
    -d '{
      "phone": "0241234567",
      "network": "yello",
      "size_gb": 1
    }'

Buy AirtelTigo iShare 2GB:
  curl -X POST "${API_BASE_URL}/v1/buy-data" \\
    -H "Authorization: Bearer sk_live_your_api_key" \\
    -H "Content-Type: application/json" \\
    -d '{
      "phone": "0271234567",
      "network": "at_ishare",
      "size_gb": 2
    }'

Poll order status:
  curl -X GET "${API_BASE_URL}/v1/orders/ORD-ABC123XYZ" \\
    -H "Authorization: Bearer sk_live_your_api_key"
`
}

function wrapLines(text: string, maxChars: number): string[] {
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    if (raw.length <= maxChars) {
      lines.push(raw)
      continue
    }
    let remaining = raw
    while (remaining.length > maxChars) {
      let breakAt = remaining.lastIndexOf(' ', maxChars)
      if (breakAt < maxChars * 0.5) breakAt = maxChars
      lines.push(remaining.slice(0, breakAt))
      remaining = remaining.slice(breakAt).trimStart()
    }
    if (remaining) lines.push(remaining)
  }
  return lines
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** Build a simple multi-page text PDF (no external dependency). */
function buildTextPdf(text: string): Blob {
  const pageWidth = 612
  const pageHeight = 792
  const margin = 48
  const fontSize = 9
  const lineHeight = 12
  const maxChars = 90
  const lines = wrapLines(text, maxChars)
  const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight)
  const pages: string[][] = []

  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage))
  }
  if (pages.length === 0) pages.push([''])

  const objects: string[] = []
  const offsets: number[] = [0]

  const addObject = (content: string) => {
    offsets.push(0) // filled later
    objects.push(content)
    return objects.length
  }

  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>')
  const contentIds: number[] = []

  for (const pageLines of pages) {
    let y = pageHeight - margin
    const ops = ['BT', `/F1 ${fontSize} Tf`, '14 TL']
    pageLines.forEach((line, index) => {
      const safe = escapePdfText(line || ' ')
      if (index === 0) {
        ops.push(`${margin} ${y} Td`, `(${safe}) Tj`)
      } else {
        ops.push('T*', `(${safe}) Tj`)
      }
    })
    ops.push('ET')
    const stream = ops.join('\n')
    contentIds.push(
      addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
    )
  }

  const pageIds: number[] = []
  for (const contentId of contentIds) {
    pageIds.push(
      addObject(
        `<< /Type /Page /Parent PAGES_REF /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
      ),
    )
  }

  const kids = pageIds.map((id) => `${id} 0 R`).join(' ')
  const pagesId = addObject(`<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`)
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  // Patch page parent refs
  for (let i = 0; i < objects.length; i++) {
    objects[i] = objects[i].replace(/PAGES_REF/g, `${pagesId} 0 R`)
  }

  let pdf = '%PDF-1.4\n'
  for (let i = 0; i < objects.length; i++) {
    offsets[i + 1] = pdf.length
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }

  const xrefPos = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`
  pdf += `startxref\n${xrefPos}\n%%EOF`

  return new Blob([pdf], { type: 'application/pdf' })
}

/** Download API docs as a multi-page PDF. */
export async function downloadApiDocsPdf() {
  const blob = buildTextPdf(buildApiDocsText())
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'swiftdata-api-documentation.pdf'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
