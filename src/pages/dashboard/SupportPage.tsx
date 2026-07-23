import { MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { whatsappLink } from '../../lib/providerStatusSync'
import { supabase } from '../../lib/supabase'
import type { SupportContact } from '../../types/database'

function complaintMessage(userName: string | null, userEmail: string | null, orderRef?: string) {
  const lines = [
    'Hello, I need help with my SwiftData order.',
    userName ? `Name: ${userName}` : null,
    userEmail ? `Email: ${userEmail}` : null,
    orderRef ? `Order reference: ${orderRef}` : null,
    '',
    'Issue: ',
  ].filter(Boolean)
  return lines.join('\n')
}

export default function SupportPage() {
  const { user } = useAuth()
  const [contacts, setContacts] = useState<SupportContact[]>([])
  const [loading, setLoading] = useState(true)
  const [orderRef, setOrderRef] = useState('')

  useEffect(() => {
    void supabase
      .from('support_contacts')
      .select('*')
      .eq('active', true)
      .order('display_order')
      .order('created_at')
      .then(({ data }) => {
        setContacts((data as SupportContact[]) ?? [])
        setLoading(false)
      })
  }, [])

  const name = user?.full_name ?? null
  const email = user?.email ?? null
  const ref = orderRef.trim() || undefined

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Support"
        description="Contact our team on WhatsApp for order issues or complaints. Order statuses on your dashboard update automatically from the provider."
      />

      <Panel title="Optional order reference">
        <p className="text-sm text-muted-foreground mb-3">
          Add your order reference so support can find it faster. You can also pick one from{' '}
          <Link to="/dashboard/orders" className="text-primary font-bold hover:underline">
            All Orders
          </Link>
          .
        </p>
        <input
          value={orderRef}
          onChange={(e) => setOrderRef(e.target.value)}
          placeholder="ORD-..."
          className="w-full max-w-md h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm font-mono outline-none"
        />
      </Panel>

      <Panel title="WhatsApp support">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : contacts.length === 0 ? (
          <EmptyState
            title="Support numbers not configured yet"
            description="An admin can add WhatsApp support contacts from the admin panel."
          />
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {contacts.map((c) => (
              <a
                key={c.id}
                href={whatsappLink(c.phone, complaintMessage(name, email, ref))}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 hover:bg-emerald-500/10 transition-colors"
              >
                <div className="h-12 w-12 rounded-full bg-emerald-500/20 grid place-items-center shrink-0">
                  <MessageCircle className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <p className="font-bold">{c.label}</p>
                  <p className="text-sm text-muted-foreground">{c.phone}</p>
                  <p className="text-xs text-emerald-400 mt-1 font-bold">Open WhatsApp →</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
