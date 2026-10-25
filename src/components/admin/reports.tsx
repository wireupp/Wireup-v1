import { useMemo, useState } from 'react'
import { Download, FileDown, Info } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import { breakdownBy, buildUsageHistory, platformDailyTotals, summarizeRequests } from '@/lib/admin/selectors'
import { formatNumber, istDayKey, istMonthKey, addDaysToDayKey } from '@/lib/admin/format'
import { buildCsv, downloadCsv } from '@/lib/admin/csv'
import type { AiRequest, CreditTransaction } from '@/lib/admin/types'
import { EmptyState } from './ui'

interface ReportDef {
  key: string
  title: string
  description: string
  columns: string[]
  build: (requests: AiRequest[], transactions: CreditTransaction[], fromKey: string, toKey: string) => { rows: (string | number)[][]; }
  filename: string
}

export function ReportsPage() {
  const requests = useAdminStore(state => state.requests)
  const transactions = useAdminStore(state => state.transactions)
  const accounts = useAdminStore(state => state.accounts)
  const models = useAdminStore(state => state.models)
  const [fromKey, setFromKey] = useState(addDaysToDayKey(istDayKey(new Date()), -7))
  const [toKey, setToKey] = useState(istDayKey(new Date()))
  const [activeReport, setActiveReport] = useState('daily-usage')

  const reports: ReportDef[] = useMemo(() => [
    {
      key: 'daily-usage', title: 'Daily usage report', filename: 'daily-usage',
      description: 'Platform totals per day in the range.',
      columns: ['Day', 'Requests', 'Failed', 'Input tokens', 'Output tokens', 'Credits', 'Est. cost (INR)'],
      build: () => {
        const totals = platformDailyTotals(buildUsageHistory(requests, accounts, 90, new Date()))
        return { rows: totals.filter(row => row.day >= fromKey && row.day <= toKey).map(row => [row.day, row.requests, row.failedRequests, row.inputTokens, row.outputTokens, row.credits, row.costInr]) }
      },
    },
    {
      key: 'weekly-usage', title: 'Weekly usage report', filename: 'weekly-usage',
      description: 'Platform totals grouped by ISO week (week starting Sunday).',
      columns: ['Week starting', 'Requests', 'Input tokens', 'Output tokens', 'Credits', 'Est. cost (INR)'],
      build: () => {
        const totals = platformDailyTotals(buildUsageHistory(requests, accounts, 90, new Date())).filter(row => row.day >= fromKey && row.day <= toKey)
        const weeks = new Map<string, { requests: number; inputTokens: number; outputTokens: number; credits: number; costInr: number }>()
        for (const row of totals) {
          const date = new Date(`${row.day}T00:00:00Z`)
          const weekStart = new Date(date); weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay())
          const key = weekStart.toISOString().slice(0, 10)
          const entry = weeks.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0, credits: 0, costInr: 0 }
          entry.requests += row.requests; entry.inputTokens += row.inputTokens; entry.outputTokens += row.outputTokens
          entry.credits += row.credits; entry.costInr += row.costInr
          weeks.set(key, entry)
        }
        return { rows: Array.from(weeks.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, row]) => [key, row.requests, row.inputTokens, row.outputTokens, row.credits, Math.round(row.costInr * 100) / 100]) }
      },
    },
    {
      key: 'monthly-usage', title: 'Monthly usage report', filename: 'monthly-usage',
      description: 'Platform totals grouped by IST calendar month.',
      columns: ['Month', 'Requests', 'Input tokens', 'Output tokens', 'Credits', 'Est. cost (INR)'],
      build: () => {
        const totals = platformDailyTotals(buildUsageHistory(requests, accounts, 90, new Date())).filter(row => row.day >= fromKey && row.day <= toKey)
        const months = new Map<string, { requests: number; inputTokens: number; outputTokens: number; credits: number; costInr: number }>()
        for (const row of totals) {
          const key = istMonthKey(`${row.day}T12:00:00+05:30`)
          const entry = months.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0, credits: 0, costInr: 0 }
          entry.requests += row.requests; entry.inputTokens += row.inputTokens; entry.outputTokens += row.outputTokens
          entry.credits += row.credits; entry.costInr += row.costInr
          months.set(key, entry)
        }
        return { rows: Array.from(months.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, row]) => [key, row.requests, row.inputTokens, row.outputTokens, row.credits, Math.round(row.costInr * 100) / 100]) }
      },
    },
    {
      key: 'account-consumption', title: 'Account consumption report', filename: 'account-consumption',
      description: 'Requests and consumption per account in the range.',
      columns: ['Account', 'Email', 'Requests', 'Failed', 'Input tokens', 'Output tokens', 'Credits', 'Est. cost (INR)'],
      build: () => {
        const inRange = requests.filter(request => { const day = istDayKey(request.timestamp); return day >= fromKey && day <= toKey })
        const rows = breakdownBy(inRange, request => request.accountId, () => '')
        const failed = breakdownBy(inRange.filter(request => request.status === 'failed'), request => request.accountId, () => '')
        return {
          rows: rows.map(row => {
            const account = accounts.find(item => item.id === row.id)
            return [account?.name ?? row.id, account?.email ?? '', row.requests, failed.find(item => item.id === row.id)?.requests ?? 0, row.inputTokens, row.outputTokens, row.credits, row.costInr]
          }),
        }
      },
    },
    {
      key: 'model-consumption', title: 'Model consumption report', filename: 'model-consumption',
      description: 'Requests and tokens per model in the range.',
      columns: ['Model', 'Provider', 'Requests', 'Input tokens', 'Output tokens', 'Credits', 'Est. cost (INR)'],
      build: () => {
        const inRange = requests.filter(request => { const day = istDayKey(request.timestamp); return day >= fromKey && day <= toKey })
        return {
          rows: breakdownBy(inRange, request => request.modelId, () => '').map(row => {
            const model = models.find(item => item.id === row.id)
            return [model?.displayName ?? row.id, model?.providerId ?? '', row.requests, row.inputTokens, row.outputTokens, row.credits, row.costInr]
          }),
        }
      },
    },
    {
      key: 'token-consumption', title: 'Token consumption report', filename: 'token-consumption',
      description: 'Totals across the range plus the output-to-input ratio.',
      columns: ['Metric', 'Value'],
      build: () => {
        const inRange = requests.filter(request => { const day = istDayKey(request.timestamp); return day >= fromKey && day <= toKey })
        const summary = summarizeRequests(inRange)
        return {
          rows: [
            ['Requests', summary.count],
            ['Input tokens', summary.inputTokens],
            ['Output tokens', summary.outputTokens],
            ['Total tokens', summary.totalTokens],
            ['Output-to-input ratio', summary.inputTokens > 0 ? (summary.outputTokens / summary.inputTokens).toFixed(3) : '—'],
            ['Avg tokens / request', summary.count ? Math.round(summary.totalTokens / summary.count) : 0],
            ['Credits charged', summary.creditsCharged],
            ['Credits refunded', summary.creditsRefunded],
            ['Est. cost (INR)', summary.costInr],
          ],
        }
      },
    },
    {
      key: 'credit-allocation', title: 'Credit allocation report', filename: 'credit-allocation',
      description: 'Every credit transaction in the range (append-only ledger).',
      columns: ['Transaction ID', 'Timestamp (IST)', 'Account', 'Type', 'Amount', 'Balance after', 'Reason', 'Admin'],
      build: () => ({
        rows: transactions.filter(row => { const day = istDayKey(row.timestamp); return day >= fromKey && day <= toKey })
          .map(row => [row.id, formatInrTimestamp(row.timestamp), accounts.find(account => account.id === row.accountId)?.name ?? row.accountId, row.type, row.amount, row.balanceAfter, row.reason, row.admin]),
      }),
    },
    {
      key: 'api-cost', title: 'Estimated API cost report', filename: 'api-cost',
      description: 'Estimated provider cost per model per day (simulated pricing).',
      columns: ['Day', 'Model', 'Requests', 'Est. cost (INR)'],
      build: () => {
        const inRange = requests.filter(request => { const day = istDayKey(request.timestamp); return day >= fromKey && day <= toKey })
        const map = new Map<string, { requests: number; cost: number }>()
        for (const request of inRange) {
          const key = `${istDayKey(request.timestamp)}|${request.modelId}`
          const entry = map.get(key) ?? { requests: 0, cost: 0 }
          entry.requests += 1; entry.cost += request.estimatedCostInr
          map.set(key, entry)
        }
        return { rows: Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([key, row]) => [key.split('|')[0], key.split('|')[1], row.requests, Math.round(row.cost * 100) / 100]) }
      },
    },
    {
      key: 'failed-requests', title: 'Failed request report', filename: 'failed-requests',
      description: 'All failed, rate-limited and cancelled requests in the range.',
      columns: ['Request ID', 'Timestamp (IST)', 'Account', 'Model', 'Status', 'Error category', 'Duration (ms)'],
      build: () => ({
        rows: requests
          .filter(request => request.status !== 'success' && istDayKey(request.timestamp) >= fromKey && istDayKey(request.timestamp) <= toKey)
          .map(request => [request.id, formatInrTimestamp(request.timestamp), accounts.find(account => account.id === request.accountId)?.name ?? request.accountId, request.modelId, request.status, request.errorCategory ?? '—', request.durationMs]),
      }),
    },
  ], [requests, transactions, accounts, models, fromKey, toKey])

  const report = reports.find(item => item.key === activeReport) ?? reports[0]
  const preview = useMemo(() => report.build(requests, transactions, fromKey, toKey), [report, requests, transactions, fromKey, toKey])

  const download = () => {
    const csv = buildCsv(preview.rows, report.columns.map((header, index) => ({ header, value: (row: (string | number)[]) => row[index] })))
    downloadCsv(`wireup-${report.filename}-${fromKey}-to-${toKey}.csv`, csv)
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Reports & exports</h2>
          <p>Nine report types over the demo dataset. CSV files are generated in the browser with correct escaping — no server round-trip.</p>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-filters">
          <label className="admin-field"><span className="admin-field__label">From (IST)</span>
            <input className="admin-input" type="date" value={fromKey} onChange={event => setFromKey(event.target.value)}/></label>
          <label className="admin-field"><span className="admin-field__label">To (IST)</span>
            <input className="admin-input" type="date" value={toKey} onChange={event => setToKey(event.target.value)}/></label>
          <div className="admin-filters__spacer"/>
          <button className="admin-btn admin-btn--primary" onClick={download} disabled={preview.rows.length === 0}><Download size={13}/>Download CSV</button>
        </div>
        <div className="admin-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', padding: 14 }}>
          {reports.map(item => (
            <button key={item.key} className="admin-stat" style={{ textAlign: 'left', cursor: 'pointer', borderColor: item.key === report.key ? 'var(--a-accent-line)' : undefined, background: item.key === report.key ? 'var(--a-accent-soft)' : undefined }}
              onClick={() => setActiveReport(item.key)}>
              <span className="admin-stat__label"><FileDown size={13}/>{item.title}</span>
              <span className="admin-stat__foot">{item.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">{report.title} — preview</span>
          <span className="admin-card__hint">{fromKey} → {toKey} · {preview.rows.length} rows</span>
        </div>
        <div className="admin-table-wrap" style={{ maxHeight: 440 }}>
          {preview.rows.length === 0 ? <EmptyState title="No rows in this range" body="Widen the date range — the demo record window covers the last 21 days."/> : (
            <table className="admin-table admin-table--compact">
              <thead><tr>{report.columns.map(column => <th key={column} className={isNumericColumn(column) ? 'num' : ''}>{column}</th>)}</tr></thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className={isNumericColumn(report.columns[cellIndex]) ? 'num' : ''}>{formatCell(cell)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="admin-card__body admin-note" style={{ margin: '0 16px 14px' }}>
          <Info size={13}/>
          <span>Daily/weekly/monthly platform rows include seeded aggregate demo data for days older than the 21-day request record window. PDF export is intentionally not offered — only implemented formats are shown.</span>
        </div>
      </div>
    </div>
  )
}

function isNumericColumn(header: string): boolean {
  return /requests|tokens|credits|amount|balance|cost|duration|failed/i.test(header)
}

function formatCell(cell: string | number): string {
  if (typeof cell === 'number') return Number.isInteger(cell) ? formatNumber(cell) : formatNumber(cell, 'en-IN', 2)
  return cell
}

function formatInrTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}
