import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownUp, Coins } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import {
  breakdownBy, buildRequestSeries, buildUsageHistory, platformDailyTotals,
  requestsInPeriod, requestsInPreviousPeriod, summarizeRequests,
} from '@/lib/admin/selectors'
import { formatCompact, formatCredits, formatDayKeyShort, formatInr, formatNumber, istDayKey, istMonthKey } from '@/lib/admin/format'
import { PERIOD_LABELS } from '@/lib/admin/types'
import type { BreakdownRow } from '@/lib/admin/selectors'
import { ChartTooltip, EmptyState, SortHeader, StatCard, Tabs, toggleSort } from './ui'
import { useAdminTheme, usePeriod } from './admin-app'

type BreakdownTab = 'account' | 'model' | 'provider' | 'type' | 'date'

function BreakdownTable({ rows, label }: { rows: BreakdownRow[]; label: string }) {
  const [sort, setSort] = useState({ field: 'requests', dir: 'desc' as 'asc' | 'desc' })
  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      switch (sort.field) {
        case 'label': return a.label.localeCompare(b.label) * dir
        case 'inputTokens': return (a.inputTokens - b.inputTokens) * dir
        case 'outputTokens': return (a.outputTokens - b.outputTokens) * dir
        case 'credits': return (a.credits - b.credits) * dir
        case 'costInr': return (a.costInr - b.costInr) * dir
        default: return (a.requests - b.requests) * dir
      }
    })
  }, [rows, sort])
  if (rows.length === 0) return <EmptyState title={`No ${label} data in this period`}/>
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <SortHeader label={label} field="label" sort={sort} onSort={field => setSort(toggleSort(sort, field))}/>
            <SortHeader label="Requests" field="requests" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
            <SortHeader label="Input tokens" field="inputTokens" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
            <SortHeader label="Output tokens" field="outputTokens" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
            <SortHeader label="Credits" field="credits" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
            <SortHeader label="Est. cost" field="costInr" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.id}>
              <td className="admin-table__primary">{row.label}</td>
              <td className="num">{formatNumber(row.requests)}</td>
              <td className="num">{formatNumber(row.inputTokens)}</td>
              <td className="num">{formatNumber(row.outputTokens)}</td>
              <td className="num">{formatCredits(row.credits)}</td>
              <td className="num">{formatInr(row.costInr)}</td>
              <td className="num admin-table__sub">{rows[0].requests > 0 ? `${((row.requests / rows.reduce((sum, item) => sum + item.requests, 0)) * 100).toFixed(1)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TokenAnalyticsPage() {
  const { period } = usePeriod()
  const { themeDef } = useAdminTheme()
  const GRID = themeDef.chart.grid
  const TICK = { fill: themeDef.chart.tick, fontSize: 10 }
  const accounts = useAdminStore(state => state.accounts)
  const requests = useAdminStore(state => state.requests)
  const models = useAdminStore(state => state.models)
  const providers = useAdminStore(state => state.providers)
  const lastRefreshedAt = useAdminStore(state => state.lastRefreshedAt)
  const [tab, setTab] = useState<BreakdownTab>('model')

  const now = useMemo(() => new Date(lastRefreshedAt), [lastRefreshedAt])
  const current = useMemo(() => requestsInPeriod(requests, period, now), [requests, period, now])
  const previous = useMemo(() => requestsInPreviousPeriod(requests, period, now), [requests, period, now])
  const currentSummary = useMemo(() => summarizeRequests(current), [current])
  const previousSummary = useMemo(() => summarizeRequests(previous), [previous])

  // Hourly (today) and daily (period) token series from the request log.
  const hourly = useMemo(() => {
    const todayKey = istDayKey(now)
    const todays = requests.filter(request => istDayKey(request.timestamp) === todayKey)
    return buildRequestSeries(todays, 'today', now).map(point => ({ label: point.label, inputTokens: point.inputTokens, outputTokens: point.outputTokens }))
  }, [requests, now])
  const daily = useMemo(() => {
    const points = buildRequestSeries(current, period === 'today' ? 'today' : period, now)
    return points.map(point => ({ label: period === 'today' ? point.label : formatDayKeyShort(point.key), inputTokens: point.inputTokens, outputTokens: point.outputTokens }))
  }, [current, period, now])

  // Weekly / monthly trends use the full seeded + derived 90-day history.
  const weekly = useMemo(() => {
    const totals = platformDailyTotals(buildUsageHistory(requests, accounts, 90, now))
    const weeks = new Map<string, { label: string; inputTokens: number; outputTokens: number; sort: string }>()
    for (const row of totals) {
      const date = new Date(`${row.day}T00:00:00Z`)
      const weekStart = new Date(date)
      weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay())
      const key = weekStart.toISOString().slice(0, 10)
      const entry = weeks.get(key) ?? { label: formatDayKeyShort(key), inputTokens: 0, outputTokens: 0, sort: key }
      entry.inputTokens += row.inputTokens
      entry.outputTokens += row.outputTokens
      weeks.set(key, entry)
    }
    return Array.from(weeks.values()).sort((a, b) => a.sort.localeCompare(b.sort))
  }, [requests, accounts, now])
  const monthly = useMemo(() => {
    const totals = platformDailyTotals(buildUsageHistory(requests, accounts, 90, now))
    const months = new Map<string, { label: string; inputTokens: number; outputTokens: number; sort: string }>()
    for (const row of totals) {
      const key = istMonthKey(`${row.day}T12:00:00+05:30`)
      const entry = months.get(key) ?? { label: new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`)), inputTokens: 0, outputTokens: 0, sort: key }
      entry.inputTokens += row.inputTokens
      entry.outputTokens += row.outputTokens
      months.set(key, entry)
    }
    return Array.from(months.values()).sort((a, b) => a.sort.localeCompare(b.sort))
  }, [requests, accounts, now])

  const breakdowns: Record<BreakdownTab, { rows: BreakdownRow[]; label: string }> = {
    account: { rows: breakdownBy(current, request => request.accountId, id => accounts.find(account => account.id === id)?.name ?? id), label: 'Account' },
    model: { rows: breakdownBy(current, request => request.modelId, id => models.find(model => model.id === id)?.displayName ?? id), label: 'Model' },
    provider: { rows: breakdownBy(current, request => request.providerId, id => providers.find(provider => provider.id === id)?.name ?? id), label: 'Provider' },
    type: { rows: breakdownBy(current, request => request.type, id => String(id)), label: 'Request type' },
    date: { rows: breakdownBy(current, request => istDayKey(request.timestamp), id => id), label: 'Date' },
  }

  const ratio = currentSummary.inputTokens > 0 ? currentSummary.outputTokens / currentSummary.inputTokens : 0
  const prevRatio = previousSummary.inputTokens > 0 ? previousSummary.outputTokens / previousSummary.inputTokens : 0
  const growth = previousSummary.totalTokens > 0 ? ((currentSummary.totalTokens - previousSummary.totalTokens) / previousSummary.totalTokens) * 100 : null
  const tokensPerAccount = currentSummary.activeAccounts > 0 ? Math.round(currentSummary.totalTokens / currentSummary.activeAccounts) : 0
  const topAccounts = breakdowns.account.rows.slice(0, 8)
  const topModels = breakdowns.model.rows.slice(0, 8)

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Token analytics</h2>
          <p>{PERIOD_LABELS[period]} · tokens, platform credits and estimated cost are distinct units — they are never treated as equivalent</p>
        </div>
      </div>

      <div className="admin-grid admin-grid--kpi">
        <StatCard label="Total input tokens" value={formatNumber(currentSummary.inputTokens)} icon={<Coins size={13}/>} delta={previousSummary.inputTokens ? ((currentSummary.inputTokens - previousSummary.inputTokens) / previousSummary.inputTokens) * 100 : null} deltaLabel={PERIOD_LABELS[period].toLowerCase()} tooltip="Prompt tokens across all requests in the period."/>
        <StatCard label="Total output tokens" value={formatNumber(currentSummary.outputTokens)} icon={<Coins size={13}/>} delta={previousSummary.outputTokens ? ((currentSummary.outputTokens - previousSummary.outputTokens) / previousSummary.outputTokens) * 100 : null} deltaLabel={PERIOD_LABELS[period].toLowerCase()} tooltip="Completion tokens across all requests in the period."/>
        <StatCard label="Total tokens" value={formatNumber(currentSummary.totalTokens)} icon={<ArrowDownUp size={13}/>} delta={growth} deltaLabel={PERIOD_LABELS[period].toLowerCase()} tooltip="Input + output tokens (token growth rate shown as the trend)."/>
        <StatCard label="Avg tokens / request" value={formatNumber(currentSummary.count ? Math.round(currentSummary.totalTokens / currentSummary.count) : 0)} icon={<Coins size={13}/>} delta={null} tooltip={`Total tokens divided by ${formatNumber(currentSummary.count)} requests.`}/>
        <StatCard label="Tokens / active account" value={formatNumber(tokensPerAccount)} icon={<Coins size={13}/>} delta={null} tooltip="Total tokens divided by accounts with at least one request in the period." foot={`${currentSummary.activeAccounts} active accounts`}/>
        <StatCard label="Output-to-input ratio" value={ratio.toFixed(2)} icon={<ArrowDownUp size={13}/>} delta={prevRatio ? ((ratio - prevRatio) / prevRatio) * 100 : null} deltaLabel={PERIOD_LABELS[period].toLowerCase()} tooltip="Average completion size relative to prompt size. Output tokens usually cost more."/>
        <StatCard label="Token growth" value={`${growth === null ? '—' : `${growth > 0 ? '+' : ''}${growth.toFixed(1)}%`}`} icon={<ArrowDownUp size={13}/>} delta={growth} deltaLabel={PERIOD_LABELS[period].toLowerCase()} tooltip="Change in total tokens versus the previous equivalent window."/>
        <StatCard label="Est. API cost" value={formatInr(currentSummary.costInr)} icon={<Coins size={13}/>} delta={null} tooltip="Estimated provider cost for these tokens at the mock INR prices (Models & Providers)." foot="simulated pricing"/>
      </div>

      <div className="admin-grid admin-grid--half">
        <div className="admin-card">
          <div className="admin-card__header">
            <span className="admin-card__title">Hourly token consumption</span>
            <span className="admin-card__hint">today (IST)</span>
          </div>
          <div className="admin-card__body" style={{ padding: '12px 8px 4px' }}>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ top: 4, right: 10, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false}/>
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval={2}/>
                  <YAxis tick={TICK} tickLine={false} axisLine={false} width={48} tickFormatter={value => formatCompact(Number(value))}/>
                  <ReTooltip content={<ChartTooltip valueFormatter={value => formatCompact(value)}/>}/>
                  <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill="#4a8fd9"/>
                  <Bar dataKey="outputTokens" name="Output" stackId="tokens" fill="#3fb6a8" radius={[3, 3, 0, 0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card__header">
            <span className="admin-card__title">Daily token consumption</span>
            <span className="admin-card__hint">{PERIOD_LABELS[period].toLowerCase()}</span>
          </div>
          <div className="admin-card__body" style={{ padding: '12px 8px 4px' }}>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 4, right: 10, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradTokIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4a8fd9" stopOpacity={0.35}/><stop offset="100%" stopColor="#4a8fd9" stopOpacity={0.03}/></linearGradient>
                    <linearGradient id="gradTokOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3fb6a8" stopOpacity={0.35}/><stop offset="100%" stopColor="#3fb6a8" stopOpacity={0.03}/></linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false}/>
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={26}/>
                  <YAxis tick={TICK} tickLine={false} axisLine={false} width={48} tickFormatter={value => formatCompact(Number(value))}/>
                  <ReTooltip content={<ChartTooltip valueFormatter={value => formatCompact(value)}/>}/>
                  <Area type="monotone" dataKey="inputTokens" name="Input" stroke="#4a8fd9" fill="url(#gradTokIn)" strokeWidth={1.6}/>
                  <Area type="monotone" dataKey="outputTokens" name="Output" stroke="#3fb6a8" fill="url(#gradTokOut)" strokeWidth={1.6}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card__header">
            <span className="admin-card__title">Weekly trend</span>
            <span className="admin-card__hint">90-day view · records + seeded aggregates</span>
          </div>
          <div className="admin-card__body" style={{ padding: '12px 8px 4px' }}>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly} margin={{ top: 4, right: 10, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false}/>
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval={1}/>
                  <YAxis tick={TICK} tickLine={false} axisLine={false} width={48} tickFormatter={value => formatCompact(Number(value))}/>
                  <ReTooltip content={<ChartTooltip valueFormatter={value => formatCompact(value)}/>}/>
                  <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill="#4a8fd9"/>
                  <Bar dataKey="outputTokens" name="Output" stackId="tokens" fill="#3fb6a8" radius={[3, 3, 0, 0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card__header">
            <span className="admin-card__title">Monthly trend</span>
            <span className="admin-card__hint">90-day view · records + seeded aggregates</span>
          </div>
          <div className="admin-card__body" style={{ padding: '12px 8px 4px' }}>
            <div className="admin-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 4, right: 10, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false}/>
                  <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }}/>
                  <YAxis tick={TICK} tickLine={false} axisLine={false} width={48} tickFormatter={value => formatCompact(Number(value))}/>
                  <ReTooltip content={<ChartTooltip valueFormatter={value => formatCompact(value)}/>}/>
                  <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill="#8f7ff0"/>
                  <Bar dataKey="outputTokens" name="Output" stackId="tokens" fill="#e06c8a" radius={[3, 3, 0, 0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="admin-grid admin-grid--half">
        <div className="admin-card">
          <div className="admin-card__header"><span className="admin-card__title">Highest-consuming accounts</span><span className="admin-card__hint">by requests in period</span></div>
          {topAccounts.length === 0 ? <EmptyState title="No usage in this period"/> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Account</th><th className="num">Requests</th><th className="num">Total tokens</th><th className="num">Credits</th></tr></thead>
                <tbody>
                  {topAccounts.map(row => (
                    <tr key={row.id}>
                      <td className="admin-table__primary">{row.label}</td>
                      <td className="num">{formatNumber(row.requests)}</td>
                      <td className="num">{formatNumber(row.inputTokens + row.outputTokens)}</td>
                      <td className="num">{formatCredits(row.credits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="admin-card">
          <div className="admin-card__header"><span className="admin-card__title">Highest-consuming models</span><span className="admin-card__hint">by total tokens in period</span></div>
          {topModels.length === 0 ? <EmptyState title="No usage in this period"/> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Model</th><th className="num">Requests</th><th className="num">Total tokens</th><th className="num">Credits</th></tr></thead>
                <tbody>
                  {topModels.map(row => (
                    <tr key={row.id}>
                      <td className="admin-table__primary">{row.label}</td>
                      <td className="num">{formatNumber(row.requests)}</td>
                      <td className="num">{formatNumber(row.inputTokens + row.outputTokens)}</td>
                      <td className="num">{formatCredits(row.credits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__header"><span className="admin-card__title">Breakdowns</span><span className="admin-card__hint">{PERIOD_LABELS[period].toLowerCase()} · sortable</span></div>
        <Tabs active={tab} onChange={key => setTab(key as BreakdownTab)} tabs={[
          { key: 'model', label: 'By model' },
          { key: 'account', label: 'By account' },
          { key: 'provider', label: 'By provider' },
          { key: 'type', label: 'By request type' },
          { key: 'date', label: 'By date' },
        ]}/>
        <BreakdownTable key={tab} rows={breakdowns[tab].rows} label={breakdowns[tab].label}/>
      </div>
    </div>
  )
}
