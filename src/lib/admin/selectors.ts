// Derived analytics for the admin console. Pure functions over the store state;
// components call these inside useMemo. Series derived from the visible request
// log are exact; windows older than the record window fall back to seeded
// aggregate demo data (labelled as such in the UI).

import { mulberry32 } from './mock-data'
import { addDaysToDayKey, istDayKey, istDayStartMs } from './format'
import type { Account, AiRequest, DailyUsage, PeriodKey } from './types'

export interface RequestSummary {
  count: number
  successCount: number
  failedCount: number
  rateLimitedCount: number
  cancelledCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  creditsCharged: number
  creditsReserved: number
  creditsRefunded: number
  costInr: number
  avgLatencyMs: number
  activeAccounts: number
  successRate: number
}

export function summarizeRequests(requests: AiRequest[]): RequestSummary {
  const summary: RequestSummary = {
    count: requests.length, successCount: 0, failedCount: 0, rateLimitedCount: 0, cancelledCount: 0,
    inputTokens: 0, outputTokens: 0, totalTokens: 0, creditsCharged: 0, creditsReserved: 0, creditsRefunded: 0,
    costInr: 0, avgLatencyMs: 0, activeAccounts: 0, successRate: 0,
  }
  const latency = requests.length ? requests.reduce((sum, request) => sum + request.durationMs, 0) / requests.length : 0
  const accounts = new Set<string>()
  for (const request of requests) {
    if (request.status === 'success') summary.successCount += 1
    else if (request.status === 'failed') summary.failedCount += 1
    else if (request.status === 'rate_limited') summary.rateLimitedCount += 1
    else summary.cancelledCount += 1
    summary.inputTokens += request.inputTokens
    summary.outputTokens += request.outputTokens
    summary.creditsCharged += request.creditsCharged
    summary.creditsReserved += request.creditsReserved
    summary.creditsRefunded += request.creditsRefunded
    summary.costInr += request.estimatedCostInr
    accounts.add(request.accountId)
  }
  summary.totalTokens = summary.inputTokens + summary.outputTokens
  summary.costInr = Math.round(summary.costInr * 100) / 100
  summary.avgLatencyMs = Math.round(latency)
  summary.activeAccounts = accounts.size
  summary.successRate = requests.length ? (summary.successCount / requests.length) * 100 : 0
  return summary
}

const PERIOD_DAYS: Record<Exclude<PeriodKey, 'today'>, number> = { '7d': 7, '30d': 30, '90d': 90 }

/** Request records inside the selected period (inclusive of today, IST). */
export function requestsInPeriod(requests: AiRequest[], period: PeriodKey, now = new Date()): AiRequest[] {
  if (period === 'today') {
    const todayKey = istDayKey(now)
    return requests.filter(request => istDayKey(request.timestamp) === todayKey)
  }
  const days = PERIOD_DAYS[period]
  const from = istDayStartMs(addDaysToDayKey(istDayKey(now), -(days - 1)))
  return requests.filter(request => new Date(request.timestamp).getTime() >= from)
}

/** The immediately preceding equivalent window, for period-over-period deltas. */
export function requestsInPreviousPeriod(requests: AiRequest[], period: PeriodKey, now = new Date()): AiRequest[] {
  if (period === 'today') {
    const yesterdayKey = addDaysToDayKey(istDayKey(now), -1)
    return requests.filter(request => istDayKey(request.timestamp) === yesterdayKey)
  }
  const days = PERIOD_DAYS[period]
  const periodStart = istDayStartMs(addDaysToDayKey(istDayKey(now), -(days - 1)))
  const prevEnd = periodStart - 1
  const prevStart = istDayStartMs(addDaysToDayKey(istDayKey(now), -(2 * days - 1)))
  return requests.filter(request => {
    const time = new Date(request.timestamp).getTime()
    return time >= prevStart && time <= prevEnd
  })
}

export interface SeriesPoint {
  key: string
  label: string
  requests: number
  failedRequests: number
  inputTokens: number
  outputTokens: number
  credits: number
  costInr: number
  latencyMs: number
  activeAccounts: number
}

/** Time series of the visible request log. Hourly buckets for today, daily otherwise. */
export function buildRequestSeries(requests: AiRequest[], period: PeriodKey, _now = new Date()): SeriesPoint[] {
  const points = new Map<string, { point: SeriesPoint; requests: AiRequest[] }>()
  const ensure = (key: string, label: string) => {
    let entry = points.get(key)
    if (!entry) {
      entry = { point: { key, label, requests: 0, failedRequests: 0, inputTokens: 0, outputTokens: 0, credits: 0, costInr: 0, latencyMs: 0, activeAccounts: 0 }, requests: [] }
      points.set(key, entry)
    }
    return entry
  }
  if (period === 'today') {
    for (let hour = 0; hour < 24; hour++) {
      const label = `${String(hour).padStart(2, '0')}:00`
      ensure(label, label)
    }
  }
  const hourFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false })
  for (const request of requests) {
    const date = new Date(request.timestamp)
    let key: string
    if (period === 'today') {
      const hour = Number(hourFormatter.format(date)) % 24
      key = `${String(hour).padStart(2, '0')}:00`
    } else {
      key = istDayKey(date)
    }
    ensure(key, key).requests.push(request)
  }
  const result: SeriesPoint[] = []
  for (const { point, requests: bucketRequests } of points.values()) {
    const summary = summarizeRequests(bucketRequests)
    result.push({
      key: point.key, label: point.label, requests: summary.count, failedRequests: summary.failedCount,
      inputTokens: summary.inputTokens, outputTokens: summary.outputTokens, credits: summary.creditsCharged,
      costInr: summary.costInr, latencyMs: summary.avgLatencyMs, activeAccounts: summary.activeAccounts,
    })
  }
  result.sort((a, b) => a.key.localeCompare(b.key))
  return result
}


/**
 * 90-day per-account daily usage. Days covered by the request log are derived
 * from it exactly; older days are deterministic seeded aggregates (demo data).
 */
export function buildUsageHistory(requests: AiRequest[], accounts: Account[], days = 90, now = new Date()): DailyUsage[] {
  const todayKey = istDayKey(now)
  const oldestKey = addDaysToDayKey(todayKey, -(days - 1))
  const byKey = new Map<string, DailyUsage>()
  for (const request of requests) {
    const day = istDayKey(request.timestamp)
    if (day < oldestKey) continue
    let row = byKey.get(`${day}|${request.accountId}`)
    if (!row) {
      row = { day, accountId: request.accountId, requests: 0, failedRequests: 0, inputTokens: 0, outputTokens: 0, credits: 0, costInr: 0 }
      byKey.set(`${day}|${request.accountId}`, row)
    }
    row.requests += 1
    if (request.status === 'failed') row.failedRequests += 1
    row.inputTokens += request.inputTokens
    row.outputTokens += request.outputTokens
    row.credits += request.creditsCharged
    row.costInr += request.estimatedCostInr
  }
  // Seeded aggregates for the days before the record window (labelled demo data in charts).
  const recordStartKey = requests.length ? istDayKey(requests[requests.length - 1].timestamp) : todayKey
  const rng = mulberry32(0xa6a6_2026)
  const scale = requests.length
    ? requests.reduce((sum, request) => sum + request.inputTokens + request.outputTokens, 0) / Math.max(1, new Set(requests.map(r => istDayKey(r.timestamp))).size)
    : 0
  for (let day = addDaysToDayKey(oldestKey, 0); day < recordStartKey; day = addDaysToDayKey(day, 1)) {
    const platformRequests = Math.round(5 + rng() * 5)
    for (let i = 0; i < platformRequests; i++) {
      const account = accounts[Math.floor(rng() * accounts.length)]
      if (!account) continue
      const tokens = Math.round((scale || 1200) * (0.5 + rng()))
      const key = `${day}|${account.id}`
      let row = byKey.get(key)
      if (!row) {
        row = { day, accountId: account.id, requests: 0, failedRequests: 0, inputTokens: 0, outputTokens: 0, credits: 0, costInr: 0 }
        byKey.set(key, row)
      }
      const failed = rng() < 0.06
      row.requests += 1
      if (failed) row.failedRequests += 1
      row.inputTokens += Math.round(tokens * (0.55 + rng() * 0.2))
      row.outputTokens += Math.round(tokens * (0.25 + rng() * 0.2))
      row.credits += Math.round(4 + rng() * 14)
      row.costInr += Math.round((0.05 + rng() * 0.4) * 100) / 100
    }
  }
  return Array.from(byKey.values())
}

export function platformDailyTotals(usage: DailyUsage[]): { day: string; requests: number; failedRequests: number; inputTokens: number; outputTokens: number; credits: number; costInr: number; activeAccounts: number }[] {
  const map = new Map<string, { day: string; requests: number; failedRequests: number; inputTokens: number; outputTokens: number; credits: number; costInr: number; activeAccounts: number }>()
  for (const row of usage) {
    let entry = map.get(row.day)
    if (!entry) {
      entry = { day: row.day, requests: 0, failedRequests: 0, inputTokens: 0, outputTokens: 0, credits: 0, costInr: 0, activeAccounts: 0 }
      map.set(row.day, entry)
    }
    entry.requests += row.requests
    entry.failedRequests += row.failedRequests
    entry.inputTokens += row.inputTokens
    entry.outputTokens += row.outputTokens
    entry.credits += row.credits
    entry.costInr += row.costInr
    entry.activeAccounts += 1
  }
  return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day))
}

export interface BreakdownRow { id: string; label: string; requests: number; inputTokens: number; outputTokens: number; credits: number; costInr: number; errors: number }

export function breakdownBy<B extends string | number>(
  requests: AiRequest[], keyOf: (request: AiRequest) => B, labelOf: (key: B) => string,
): BreakdownRow[] {
  const map = new Map<B, BreakdownRow>()
  for (const request of requests) {
    const key = keyOf(request)
    let row = map.get(key)
    if (!row) {
      row = { id: String(key), label: labelOf(key), requests: 0, inputTokens: 0, outputTokens: 0, credits: 0, costInr: 0, errors: 0 }
      map.set(key, row)
    }
    row.requests += 1
    row.inputTokens += request.inputTokens
    row.outputTokens += request.outputTokens
    row.credits += request.creditsCharged
    row.costInr += request.estimatedCostInr
    if (request.status === 'failed') row.errors += 1
  }
  return Array.from(map.values()).sort((a, b) => b.requests - a.requests)
}

/** Accounts whose daily usage has crossed `thresholdPercent` of their daily allowance. */
export function accountsApproachingLimit(accounts: Account[], thresholdPercent = 80): Account[] {
  return accounts.filter(account => account.limits.daily > 0 && account.status === 'active' && (account.usage.dailyCreditsUsed / account.limits.daily) * 100 >= thresholdPercent)
}

export function totalCreditsAcrossAccounts(accounts: Account[]): number {
  return Math.round(accounts.reduce((sum, account) => sum + account.balances.daily + account.balances.permanent + account.balances.promotional, 0) * 100) / 100
}
