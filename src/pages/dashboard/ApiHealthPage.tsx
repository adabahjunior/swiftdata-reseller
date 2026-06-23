import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState, PageHeader, Panel, StatCard } from '../../components/dashboard/ui'
import { useApiLogs } from '../../hooks/useDashboardData'
import { formatRelativeTime } from '../../lib/format'

const ENDPOINTS = [
  { path: '/v1/health', method: 'GET', description: 'API health and supported networks' },
  { path: '/v1/buy-data', method: 'POST', description: 'Purchase a data bundle' },
  { path: '/v1/balance', method: 'GET', description: 'Check API wallet balance' },
  { path: '/v1/orders', method: 'GET', description: 'List your orders' },
  { path: '/v1/orders/{id}', method: 'GET', description: 'Get order by reference' },
  { path: '/v1/packages', method: 'GET', description: 'List available packages' },
]

export default function ApiHealthPage() {
  const { logs, loading } = useApiLogs(200)

  const stats = useMemo(() => {
    if (logs.length === 0) {
      return { uptime: 100, avgMs: 0, errorRate: 0, total: 0 }
    }
    const success = logs.filter((l) => l.status_code >= 200 && l.status_code < 400).length
    const errors = logs.filter((l) => l.status_code >= 400).length
    const avgMs = Math.round(logs.reduce((s, l) => s + l.response_time_ms, 0) / logs.length)
    return {
      uptime: Math.round((success / logs.length) * 100),
      avgMs,
      errorRate: Math.round((errors / logs.length) * 100),
      total: logs.length,
    }
  }, [logs])

  const endpointStats = useMemo(() => {
    const map: Record<string, { count: number; errors: number; avgMs: number }> = {}
    for (const log of logs) {
      if (!map[log.endpoint]) map[log.endpoint] = { count: 0, errors: 0, avgMs: 0 }
      map[log.endpoint].count++
      if (log.status_code >= 400) map[log.endpoint].errors++
      map[log.endpoint].avgMs += log.response_time_ms
    }
    for (const key of Object.keys(map)) {
      map[key].avgMs = Math.round(map[key].avgMs / map[key].count)
    }
    return map
  }, [logs])

  const isHealthy = stats.errorRate < 5

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="API Health"
        description="Monitor endpoint availability, response times, and recent request activity."
      />

      <div
        className={`rounded-2xl border p-5 flex items-center gap-4 ${
          isHealthy
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-amber-500/30 bg-amber-500/5'
        }`}
      >
        {isHealthy ? (
          <CheckCircle2 className="h-8 w-8 text-emerald-400 shrink-0" />
        ) : (
          <AlertTriangle className="h-8 w-8 text-amber-400 shrink-0" />
        )}
        <div>
          <p className="font-black text-lg">{isHealthy ? 'All Systems Operational' : 'Degraded Performance'}</p>
          <p className="text-sm text-muted-foreground">
            {logs.length === 0
              ? 'No API requests recorded yet. Activity will appear after your first API call.'
              : `${stats.uptime}% success rate across ${stats.total} recent requests.`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Uptime" value={`${stats.uptime}%`} accent />
        <StatCard label="Avg Response" value={stats.avgMs > 0 ? `${stats.avgMs}ms` : '—'} />
        <StatCard label="Error Rate" value={`${stats.errorRate}%`} />
        <StatCard label="Total Requests" value={String(stats.total)} />
      </div>

      <Panel title="Endpoint Status">
        <div className="space-y-3">
          {ENDPOINTS.map((ep) => {
            const epStats = endpointStats[ep.path]
            const status = !epStats ? 'idle' : epStats.errors === 0 ? 'healthy' : 'warning'
            return (
              <div
                key={ep.path}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-black uppercase bg-white/10 px-2 py-0.5 rounded">
                      {ep.method}
                    </span>
                    <code className="text-sm font-mono">{ep.path}</code>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{ep.description}</p>
                </div>
                <div className="flex items-center gap-4 text-sm shrink-0">
                  {epStats ? (
                    <>
                      <span className="text-muted-foreground">{epStats.count} calls</span>
                      <span className="text-muted-foreground">{epStats.avgMs}ms</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No data</span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold ${
                      status === 'healthy'
                        ? 'text-emerald-400'
                        : status === 'warning'
                          ? 'text-amber-400'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {status === 'healthy' ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : status === 'warning' ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" />
                    )}
                    {status === 'healthy' ? 'Healthy' : status === 'warning' ? 'Errors' : 'Idle'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Recent Requests">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading logs…</p>
        ) : logs.length === 0 ? (
          <EmptyState
            title="No request logs"
            description="API calls will be logged here with response times and status codes."
          />
        ) : (
          <div className="overflow-x-auto -mx-5 md:-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-left">
                  <th className="px-5 md:px-6 py-3 font-medium">Time</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Method</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Endpoint</th>
                  <th className="px-5 md:px-6 py-3 font-medium">Status</th>
                  <th className="px-5 md:px-6 py-3 font-medium text-right">Response</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {logs.slice(0, 20).map((log) => (
                  <tr key={log.id}>
                    <td className="px-5 md:px-6 py-3 text-muted-foreground whitespace-nowrap">
                      {formatRelativeTime(log.created_at)}
                    </td>
                    <td className="px-5 md:px-6 py-3 font-mono text-xs">{log.method}</td>
                    <td className="px-5 md:px-6 py-3 font-mono text-xs">{log.endpoint}</td>
                    <td className="px-5 md:px-6 py-3">
                      <span
                        className={`font-bold ${
                          log.status_code < 400 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {log.status_code}
                      </span>
                    </td>
                    <td className="px-5 md:px-6 py-3 text-right text-muted-foreground">
                      {log.response_time_ms}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
