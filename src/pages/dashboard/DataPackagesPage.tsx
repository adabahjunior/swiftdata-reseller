import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { usePackages } from '../../hooks/useDashboardData'
import { NETWORK_COLORS, PACKAGE_NETWORKS, dbNetworkToApi } from '../../lib/constants'
import { formatCurrency } from '../../lib/format'

export default function DataPackagesPage() {
  const { packages, loading } = usePackages()

  const grouped = packages.reduce<Record<string, typeof packages>>((acc, pkg) => {
    if (!acc[pkg.network]) acc[pkg.network] = []
    acc[pkg.network].push(pkg)
    return acc
  }, {})

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Data Packages"
        description="Available bundles you can purchase via API. Use network + size_gb in buy-data requests."
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading packages…</p>
      ) : packages.length === 0 ? (
        <EmptyState title="No packages available" description="Check back soon for updated pricing." />
      ) : (
        Object.entries(grouped).map(([network, items]) => (
          <Panel
            key={network}
            title={PACKAGE_NETWORKS.find((n) => n.id === network)?.label ?? network}
            description={`${items.length} package(s) · ${items[0]?.validity ?? 'Non expiry'}`}
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((pkg) => (
                <div
                  key={pkg.id}
                  className={`rounded-xl border p-4 ${NETWORK_COLORS[network] ?? 'border-white/10 bg-white/[0.02]'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-2xl">{pkg.size_gb} GB</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{pkg.validity}</p>
                    </div>
                    <p className="font-black text-lg">{formatCurrency(Number(pkg.price))}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 font-mono">
                    network: {dbNetworkToApi(network)} · size_gb: {pkg.size_gb}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        ))
      )}
    </div>
  )
}
