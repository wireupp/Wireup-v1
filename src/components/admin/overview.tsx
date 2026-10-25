import { useMemo, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis,
} from 'recharts'
import { AlertTriangle, CircleCheck, Clock, Coins, CreditCard, IndianRupee, ListChecks, Timer, TrendingUp, Users, Zap } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import {
  accountsApproachingLimit, breakdownBy, buildRequestSeries, buildUsageHistory,
  platformDailyTotals, requestsInPeriod, requestsInPreviousPeriod, summarizeRequests,
} from '@/lib/admin/selectors'
import {
  formatCompact, formatCredits, formatDayKeyShort, formatDuration, formatInr, formatIstTime,
  istDayKey, istDayStartMs, addDaysToDayKey, percentChange,
} from '@/lib/admin/format'
import { PERIOD_LABELS, REQUEST_TYPE_LABELS } from '@/lib/admin/types'
import type { AiRequest } from '@/lib/admin/types'
import { ChartTooltip, EmptyState, RequestStatusBadge, StatCard } from './ui'
import { RequestDrawer } from './request-drawer'
import { useAdminTheme, usePeriod } from './admin-app'
import type { SeriesPoint } from '@/lib/admin/selectors'

const CHART_COLORS = ['#4a8fd9', '#3fb6a8', '#8f7ff0', '#d9a13c', '#e06c8a', '#6b7280', '#3fae7c', '#e05a5a']

function ChartFrame({ title, hint, children, sim }: { title: string; hint?: string; children: React.ReactNode; sim?: boolean }) {
  return (
    <div className="admin-card">
      <div className="admin-card__header">
        <span className="admin-card__title">{title}</span>
        <span className="admin-card__hint">{hint}{sim && <> · <span className="admin-sim-tag">seeded demo data</span></>}</span>
      </div>
      <div className="admin-card__body admin-card__body--flush" style={{ padding: '12px 8px 4px' }}>{children}</div>
    </div>
  )
}

function xTickFormatter(point: SeriesPoint, period: string): string {
  return period === 'today' ? point.label : formatDayKeyShort(point.key)
}

function periodStartMs(period: 'today' | '7d' | '30d' | '90d', now: Date): number {
  if (period === 'today') return istDayStartMs(istDayKey(now))
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  return istDayStartMs(addDaysToDayKey(istDayKey(now), -(days - 1)))
}

const SYSTEM_COMPONENTS = [
  { name: 'Sarvam AI provider', detail: 'Mock connectivity — no live API call', state: 'ok' as const },
  { name: 'AI request processing', detail: 'Derived from the mock request log', state: 'ok' as const },
  { name: 'Credit accounting', detail: 'Client-side simulation only', state: 'ok' as const },
  { name: 'Daily reset scheduler', detail: 'Simulated until a Cloud Function scheduler exists', state: 'pending' as const },
  { name: 'Account authentication', detail: 'Firebase Auth not wired to this console yet', state: 'pending' as const },
  { name: 'Usage logging', detail: 'In-memory + localStorage (demo)', state: 'ok' as const },
]

export function OverviewPage() {
  const { period } = usePeriod()
  const { themeDef } = useAdminTheme()
  const GRID = themeDef.chart.grid
  const TICK = { fill: themeDef.chart.tick, fontSize: 10 }
  const accounts = useAdminStore(state => state.accounts)
  const requests = useAdminStore(state => state.requests)
  const models = useAdminStore(state => state.models)
  const lastRefreshedAt = useAdminStore(state => state.lastRefreshedAt)
  const [selectedRequest, setSelectedRequest] = useState<AiRequest | null>(null)

  const now = useMemo(() => new Date(lastRefreshedAt), [lastRefreshedAt])
  const current = useMemo(() => requestsInPeriod(requests, period, now), [requests, period, now])
  const previous = useMemo(() => requestsInPreviousPeriod(requests, period, now), [requests, period, now])
  const currentSummary = useMemo(() => summarizeRequests(current), [current])
  const previousSummary = useMemo(() => summarizeRequests(previous), [previous])

  const series = useMemo<SeriesPoint[]>(() => {
    if (period === 'today' || period === '7d') return buildRequestSeries(current, period, now)
    const usage = buildUsageHistory(requests, accounts, period === '30d' ? 30 : 90, now)
    return platformDailyTotals(usage).map(row => ({
      key: row.day, label: row.day, requests: row.requests, failedRequests: row.failedRequests,
      inputTokens: row.inputTokens, outputTokens: row.outputTokens, credits: row.credits,
      costInr: row.costInr, latencyMs: 0, activeAccounts: row.activeAccounts,
    }))
  }, [current, period, now, requests, accounts])

  const usesSeededSeries = period === '30d' || period === '90d'
  const startMs = periodStartMs(period, now)
  const accountsAtStart = accounts.filter(account => new Date(account.createdAt).getTime() <= startMs).length
  const newAccounts = accounts.filter(account => new Date(account.createdAt).getTime() > startMs).length
  const approaching = useMemo(() => accountsApproachingLimit(accounts, 80), [accounts])

  const modelBreakdown = useMemo(() => breakdownBy(current, request => request.modelId, id => models.find(model => model.id === id)?.displayName ?? id).slice(0, 6), [current, models])
  const accountBreakdown = useMemo(() => breakdownBy(current, request => request.accountId, id => accounts.find(account => account.id === id)?.name ?? id).slice(0, 8), [current, accounts])
  const statusPie = useMemo(() => [
    { name: 'Success', value: currentSummary.successCount, color: '#3fae7c' },
    { name: 'Failed', value: currentSummary.failedCount, color: '#e05a5a' },
    { name: 'Rate limited', value: currentSummary.rateLimitedCount, color: '#d9a13c' },
    { name: 'Cancelled', value: currentSummary.cancelledCount, color: '#6b7280' },
  ].filter(slice => slice.value > 0), [currentSummary])
  const recent = useMemo(() => current.slice(0, 10), [current])
  const deltaLabel = period === 'today' ? 'yesterday' : `previous ${PERIOD_LABELS[period].toLowerCase()}`

  const compact = (value: number) => formatCompact(value)
  const costFormatter = (value: number) => formatInr(value)
  const creditFormatter = (value: number) => formatCredits(value)

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Platform overview</h2>
          <p>{PERIOD_LABELS[period]} · all figures derived from the synthetic demo dataset · {accounts.length} accounts configured</p>
        </div>
      </div>

      <div className="admin-grid admin-grid--kpi">
        <StatCard label="Total accounts" value={String(accounts.length)} delta={accountsAtStart ? percentChange(accounts.length, accountsAtStart) : null} deltaLabel="period start" icon={<Users size={13}/>} tooltip="All accounts in the demo dataset, including suspended and pending ones." foot={`${accountsAtStart} at period start`}/>
        <StatCard label="Active accounts" value={String(accounts.filter(account => account.status === 'active').length)} icon={<CircleCheck size={13}/>} delta={null} tooltip="Accounts currently in Active status. Snapshot metric — no history is simulated."/>
        <StatCard label="New accounts" value={String(newAccounts)} delta={null} deltaLabel={deltaLabel} icon={<TrendingUp size={13}/>} tooltip={`Accounts created during ${PERIOD_LABELS[period].toLowerCase()}.`} foot="in selected period"/>
        <StatCard label="AI requests" value={compact(currentSummary.count)} delta={percentChange(currentSummary.count, previousSummary.count)} deltaLabel={deltaLabel} icon={<Zap size={13}/>} tooltip="All AI requests in the selected window, including failed and rate-limited attempts."/>
        <StatCard label="Input tokens" value={compact(currentSummary.inputTokens)} delta={percentChange(currentSummary.inputTokens, previousSummary.inputTokens)} deltaLabel={deltaLabel} icon={<Coins size={13}/>} tooltip="Prompt tokens billed by the provider (simulated)."/>
        <StatCard label="Output tokens" value={compact(currentSummary.outputTokens)} delta={percentChange(currentSummary.outputTokens, previousSummary.outputTokens)} deltaLabel={deltaLabel} icon={<Coins size={13}/>} tooltip="Completion tokens returned by the model (simulated)."/>
        <StatCard label="Total tokens" value={compact(currentSummary.totalTokens)} delta={percentChange(currentSummary.totalTokens, previousSummary.totalTokens)} deltaLabel={deltaLabel} icon={<ListChecks size={13}/>} tooltip="Input + output tokens across all requests in the window."/>
        <StatCard label="Credits consumed" value={formatCredits(currentSummary.creditsCharged)} delta={percentChange(currentSummary.creditsCharged, previousSummary.creditsCharged)} deltaLabel={deltaLabel} icon={<CreditCard size={13}/>} tooltip="Platform credits actually charged (refunds excluded). Credits are not equivalent to tokens."/>
        <StatCard label="Est. Sarvam cost" value={formatInr(currentSummary.costInr)} delta={percentChange(currentSummary.costInr, previousSummary.costInr)} deltaLabel={deltaLabel} icon={<IndianRupee size={13}/>} tooltip="Estimated provider cost in INR using the mock per-million-token prices from Models & Providers." foot="simulated pricing"/>
        <StatCard label="Failed requests" value={compact(currentSummary.failedCount)} delta={percentChange(currentSummary.failedCount, previousSummary.failedCount)} deltaLabel={deltaLabel} invertDelta icon={<AlertTriangle size={13}/>} tooltip="Requests that started but returned an error. Rate-limited attempts are counted separately." foot={`${currentSummary.rateLimitedCount} rate-limited`}/>
        <StatCard label="Avg latency" value={formatDuration(currentSummary.avgLatencyMs)} delta={percentChange(currentSummary.avgLatencyMs, previousSummary.avgLatencyMs)} deltaLabel={deltaLabel} invertDelta icon={<Timer size={13}/>} tooltip="Mean end-to-end request duration (simulated values)."/>
        <StatCard label="Near daily limit" value={String(approaching.length)} icon={<Clock size={13}/>} delta={null} tooltip="Active accounts that consumed ≥80% of their daily allowance in the current IST period." foot="≥80% of daily allowance"/>
      </div>

      <div className="admin-grid admin-grid--half">
        <ChartFrame title="AI requests over time" hint={usesSeededSeries ? 'records + seeded aggregates' : 'from request log'}>
          <div className="admin-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 12, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRequests" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4a8fd9" stopOpacity={0.32}/>
                    <stop offset="100%" stopColor="#4a8fd9" stopOpacity={0.02}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false}/>
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(_: string, index: number) => xTickFormatter(series[index], period)} interval="preserveStartEnd" minTickGap={28}/>
                <YAxis tick={TICK} tickLine={false} axisLine={false} width={46}/>
                <ReTooltip content={<ChartTooltip valueFormatter={value => formatCompact(value)}/>}/>
                <Area type="monotone" dataKey="requests" name="Requests" stroke="#4a8fd9" strokeWidth={1.8} fill="url(#gradRequests)"/>
                <Area type="monotone" dataKey="failedRequests" name="Failed" stroke="#e05a5a" strokeWidth={1.4} fill="transparent"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <ChartFrame title="Input vs output tokens" hint={usesSeededSeries ? 'records + seeded aggregates' : 'from request log'}>
          <div className="admin-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 4, right: 12, left: -14, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke={GRID} vertical={false}/>
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(_: string, index: number) => xTickFormatter(series[index], period)} interval="preserveStartEnd" minTickGap={28}/>
                <YAxis tick={TICK} tickLine={false} axisLine={false} width={46} tickFormatter={value => formatCompact(Number(value))}/>
                <ReTooltip content={<ChartTooltip valueFormatter={value => formatCompact(value)}/>}/>
                <Bar dataKey="inputTokens" name="Input tokens" fill="#4a8fd9" radius={[3, 3, 0, 0]}/>
                <Bar dataKey="outputTokens" name="Output tokens" fill="#3fb6a8" radius={[3, 3, 0, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <ChartFrame title="Credits consumed over time" hint="platform credits ≠ tokens">
          <div className="admin-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCredits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8f7ff0" stopOpacity={0.3}/>
                    <stop offset="100%" stopColor="#8f7ff0" stopOpacity={0.02}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false}/>
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(_: string, index: number) => xTickFormatter(series[index], period)} interval="preserveStartEnd" minTickGap={28}/>
                <YAxis tick={TICK} tickLine={false} axisLine={false} width={52} tickFormatter={value => formatCompact(Number(value))}/>
                <ReTooltip content={<ChartTooltip valueFormatter={creditFormatter}/>}/>
                <Area type="monotone" dataKey="credits" name="Credits" stroke="#8f7ff0" strokeWidth={1.8} fill="url(#gradCredits)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <ChartFrame title="Estimated API cost over time" hint="mock INR pricing">
          <div className="admin-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d9a13c" stopOpacity={0.3}/>
                    <stop offset="100%" stopColor="#d9a13c" stopOpacity={0.02}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false}/>
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(_: string, index: number) => xTickFormatter(series[index], period)} interval="preserveStartEnd" minTickGap={28}/>
                <YAxis tick={TICK} tickLine={false} axisLine={false} width={52} tickFormatter={value => `₹${formatCompact(Number(value))}`}/>
                <ReTooltip content={<ChartTooltip valueFormatter={costFormatter}/>}/>
                <Area type="monotone" dataKey="costInr" name="Est. cost" stroke="#d9a13c" strokeWidth={1.8} fill="url(#gradCost)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <ChartFrame title="Usage by model" hint="requests in period">
          <div className="admin-chart">
            {modelBreakdown.length === 0 ? <div className="admin-chart-empty">No requests in this period</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelBreakdown} layout="vertical" margin={{ top: 0, right: 16, left: 30, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} horizontal={false}/>
                  <XAxis type="number" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }}/>
                  <YAxis type="category" dataKey="label" tick={{ ...TICK, fontSize: 10.5 }} tickLine={false} axisLine={false} width={130}/>
                  <ReTooltip content={<ChartTooltip valueFormatter={value => formatCompact(value)}/>}/>
                  <Bar dataKey="requests" name="Requests" radius={[0, 3, 3, 0]}>
                    {modelBreakdown.map((row, index) => <Cell key={row.id} fill={CHART_COLORS[index % CHART_COLORS.length]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartFrame>

        <ChartFrame title="Usage by account" hint="top accounts by requests">
          <div className="admin-chart">
            {accountBreakdown.length === 0 ? <div className="admin-chart-empty">No requests in this period</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={accountBreakdown} layout="vertical" margin={{ top: 0, right: 16, left: 30, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} horizontal={false}/>
                  <XAxis type="number" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }}/>
                  <YAxis type="category" dataKey="label" tick={{ ...TICK, fontSize: 10.5 }} tickLine={false} axisLine={false} width={120}/>
                  <ReTooltip content={<ChartTooltip valueFormatter={value => formatCompact(value)}/>}/>
                  <Bar dataKey="requests" name="Requests" fill="#3fb6a8" radius={[0, 3, 3, 0]}/>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartFrame>

        <ChartFrame title="Success vs failure" hint="share of requests">
          <div className="admin-chart">
            {statusPie.length === 0 ? <div className="admin-chart-empty">No requests in this period</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <ReTooltip content={<ChartTooltip/>}/>
                  <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="78%" paddingAngle={2} strokeWidth={0}>
                    {statusPie.map(slice => <Cell key={slice.name} fill={slice.color}/>)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartFrame>

        <ChartFrame title="Daily active accounts" hint="accounts with ≥1 request">
          <div className="admin-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 12, left: -22, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false}/>
                <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(_: string, index: number) => xTickFormatter(series[index], period)} interval="preserveStartEnd" minTickGap={28}/>
                <YAxis tick={TICK} tickLine={false} axisLine={false} width={42} allowDecimals={false}/>
                <ReTooltip content={<ChartTooltip/>}/>
                <Line type="monotone" dataKey="activeAccounts" name="Active accounts" stroke="#e06c8a" strokeWidth={1.8} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">Recent activity</span>
          <span className="admin-card__hint">Newest {recent.length} of {currentSummary.count} requests in period · click a row for details</span>
        </div>
        <div className="admin-table-wrap">
          {recent.length === 0 ? <EmptyState title="No requests in this period"/> : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Time</th><th>Account</th><th>Request type</th><th>Model</th>
                  <th className="num">Tokens</th><th className="num">Credits</th><th className="num">Est. cost</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(request => {
                  const account = accounts.find(item => item.id === request.accountId)
                  return (
                    <tr key={request.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedRequest(request)}>
                      <td className="mono">{formatIstTime(request.timestamp)}</td>
                      <td><span className="admin-table__primary">{account?.name ?? request.accountId}</span></td>
                      <td>{REQUEST_TYPE_LABELS[request.type]}</td>
                      <td className="mono">{request.modelId}</td>
                      <td className="num">{formatCompact(request.inputTokens + request.outputTokens)}</td>
                      <td className="num">{formatCredits(request.creditsCharged)}</td>
                      <td className="num">{formatInr(request.estimatedCostInr)}</td>
                      <td><RequestStatusBadge status={request.status}/></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="admin-card" style={{ maxWidth: 560 }}>
        <div className="admin-card__header">
          <span className="admin-card__title">System status</span>
          <span className="admin-sim-tag">simulated</span>
        </div>
        <div>
          {SYSTEM_COMPONENTS.map(component => (
            <div key={component.name} className="admin-sys-row">
              <span className="admin-dot" style={{ background: component.state === 'ok' ? 'var(--a-green)' : 'var(--a-amber)' }}/>
              <span className="admin-sys-row__name">{component.name}</span>
              <span className="admin-sys-row__detail">{component.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <RequestDrawer request={selectedRequest} onClose={() => setSelectedRequest(null)}/>
    </div>
  )
}
