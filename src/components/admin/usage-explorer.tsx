import { useEffect, useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import { formatCredits, formatDuration, formatInr, formatIstDateTime, formatNumber, istDayKey, istDayStartMs, addDaysToDayKey } from '@/lib/admin/format'
import { buildCsv, downloadCsv } from '@/lib/admin/csv'
import { REQUEST_TYPE_LABELS } from '@/lib/admin/types'
import type { AiRequest, RequestStatus, RequestType } from '@/lib/admin/types'
import { EmptyState, Pagination, RequestStatusBadge } from './ui'
import { RequestDrawer } from './request-drawer'
import { useDebouncedValue } from './ui'

const PAGE_SIZE = 15

interface UsageFilters {
  from: string
  to: string
  account: string
  provider: string
  model: string
  status: RequestStatus | 'all'
  type: RequestType | 'all'
  minTokens: string
  maxTokens: string
  minCost: string
  maxCost: string
  minCredits: string
  maxCredits: string
}

const EMPTY_FILTERS: UsageFilters = {
  from: '', to: '', account: 'all', provider: 'all', model: 'all', status: 'all', type: 'all',
  minTokens: '', maxTokens: '', minCost: '', maxCost: '', minCredits: '', maxCredits: '',
}

function numericFilter(value: string, subject: number): boolean {
  if (value.trim() === '') return true
  const bound = Number(value)
  if (!Number.isFinite(bound)) return true
  return subject >= bound
}

function numericFilterMax(value: string, subject: number): boolean {
  if (value.trim() === '') return true
  const bound = Number(value)
  if (!Number.isFinite(bound)) return true
  return subject <= bound
}

export function UsageExplorerPage() {
  const requests = useAdminStore(state => state.requests)
  const accounts = useAdminStore(state => state.accounts)
  const models = useAdminStore(state => state.models)
  const providers = useAdminStore(state => state.providers)
  const [filters, setFilters] = useState<UsageFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const debMinTokens = useDebouncedValue(filters.minTokens)
  const debMaxTokens = useDebouncedValue(filters.maxTokens)
  const debMinCost = useDebouncedValue(filters.minCost)
  const debMaxCost = useDebouncedValue(filters.maxCost)
  const debMinCredits = useDebouncedValue(filters.minCredits)
  const debMaxCredits = useDebouncedValue(filters.maxCredits)

  useEffect(() => { setPage(1) }, [filters.account, filters.provider, filters.model, filters.status, filters.type, filters.from, filters.to, debMinTokens, debMaxTokens, debMinCost, debMaxCost, debMinCredits, debMaxCredits])

  const filtered = useMemo(() => {
    return requests.filter(request => {
      if (filters.from) {
        const fromMs = istDayStartMs(filters.from)
        if (new Date(request.timestamp).getTime() < fromMs) return false
      }
      if (filters.to) {
        const toMs = istDayStartMs(filters.to) + 86_400_000
        if (new Date(request.timestamp).getTime() >= toMs) return false
      }
      if (filters.account !== 'all' && request.accountId !== filters.account) return false
      if (filters.provider !== 'all' && request.providerId !== filters.provider) return false
      if (filters.model !== 'all' && request.modelId !== filters.model) return false
      if (filters.status !== 'all' && request.status !== filters.status) return false
      if (filters.type !== 'all' && request.type !== filters.type) return false
      const totalTokens = request.inputTokens + request.outputTokens
      if (!numericFilter(debMinTokens, totalTokens) || !numericFilterMax(debMaxTokens, totalTokens)) return false
      if (!numericFilter(debMinCost, request.estimatedCostInr) || !numericFilterMax(debMaxCost, request.estimatedCostInr)) return false
      if (!numericFilter(debMinCredits, request.creditsCharged) || !numericFilterMax(debMaxCredits, request.creditsCharged)) return false
      return true
    })
  }, [requests, filters, debMinTokens, debMaxTokens, debMinCost, debMaxCost, debMinCredits, debMaxCredits])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selected = selectedId ? requests.find(request => request.id === selectedId) ?? null : null
  const accountById = useMemo(() => new Map(accounts.map(account => [account.id, account])), [accounts])

  const setFilter = <K extends keyof UsageFilters,>(key: K, value: UsageFilters[K]) => setFilters(previous => ({ ...previous, [key]: value }))

  const exportCsv = () => {
    const csv = buildCsv(filtered, [
      { header: 'Request ID', value: (request: AiRequest) => request.id },
      { header: 'Timestamp (IST)', value: request => formatIstDateTime(request.timestamp) },
      { header: 'Account', value: request => accountById.get(request.accountId)?.name ?? request.accountId },
      { header: 'Account email', value: request => accountById.get(request.accountId)?.email ?? '' },
      { header: 'Provider', value: request => request.providerId },
      { header: 'Model', value: request => request.modelId },
      { header: 'Request type', value: request => request.type },
      { header: 'Input tokens', value: request => request.inputTokens },
      { header: 'Output tokens', value: request => request.outputTokens },
      { header: 'Total tokens', value: request => request.inputTokens + request.outputTokens },
      { header: 'Credits reserved', value: request => request.creditsReserved },
      { header: 'Credits charged', value: request => request.creditsCharged },
      { header: 'Credits refunded', value: request => request.creditsRefunded },
      { header: 'Estimated cost (INR)', value: request => request.estimatedCostInr },
      { header: 'Duration (ms)', value: request => request.durationMs },
      { header: 'Status', value: request => request.status },
      { header: 'Error category', value: request => request.errorCategory ?? '' },
      { header: 'Retries (simulated)', value: request => request.retries },
    ])
    downloadCsv(`wireup-ai-requests-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const today = istDayKey(new Date())

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>AI usage explorer</h2>
          <p>{formatNumber(filtered.length)} of {formatNumber(requests.length)} requests · demo records cover the last 21 days ({today} back to {addDaysToDayKey(today, -20)})</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn" onClick={exportCsv}><Download size={13}/>Export CSV</button>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-filters">
          <label className="admin-field"><span className="admin-field__label">From (IST)</span>
            <input className="admin-input" type="date" max={today} value={filters.from} onChange={event => setFilter('from', event.target.value)}/></label>
          <label className="admin-field"><span className="admin-field__label">To (IST)</span>
            <input className="admin-input" type="date" max={today} value={filters.to} onChange={event => setFilter('to', event.target.value)}/></label>
          <label className="admin-field"><span className="admin-field__label">Account</span>
            <select className="admin-select" value={filters.account} onChange={event => setFilter('account', event.target.value)}>
              <option value="all">All accounts</option>
              {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select></label>
          <label className="admin-field"><span className="admin-field__label">Provider</span>
            <select className="admin-select" value={filters.provider} onChange={event => setFilter('provider', event.target.value)}>
              <option value="all">All providers</option>
              {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select></label>
          <label className="admin-field"><span className="admin-field__label">Model</span>
            <select className="admin-select" value={filters.model} onChange={event => setFilter('model', event.target.value)}>
              <option value="all">All models</option>
              {models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}
            </select></label>
          <label className="admin-field"><span className="admin-field__label">Status</span>
            <select className="admin-select" value={filters.status} onChange={event => setFilter('status', event.target.value as RequestStatus | 'all')}>
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="rate_limited">Rate limited</option>
              <option value="cancelled">Cancelled</option>
            </select></label>
          <label className="admin-field"><span className="admin-field__label">Request type</span>
            <select className="admin-select" value={filters.type} onChange={event => setFilter('type', event.target.value as RequestType | 'all')}>
              <option value="all">All types</option>
              {(Object.keys(REQUEST_TYPE_LABELS) as RequestType[]).map(type => <option key={type} value={type}>{REQUEST_TYPE_LABELS[type]}</option>)}
            </select></label>
          <label className="admin-field"><span className="admin-field__label">Min tokens</span>
            <input className="admin-input" type="number" min={0} placeholder="0" value={filters.minTokens} onChange={event => setFilter('minTokens', event.target.value)}/></label>
          <label className="admin-field"><span className="admin-field__label">Max tokens</span>
            <input className="admin-input" type="number" min={0} placeholder="∞" value={filters.maxTokens} onChange={event => setFilter('maxTokens', event.target.value)}/></label>
          <label className="admin-field"><span className="admin-field__label">Min cost ₹</span>
            <input className="admin-input" type="number" min={0} step="0.01" placeholder="0" value={filters.minCost} onChange={event => setFilter('minCost', event.target.value)}/></label>
          <label className="admin-field"><span className="admin-field__label">Max cost ₹</span>
            <input className="admin-input" type="number" min={0} step="0.01" placeholder="∞" value={filters.maxCost} onChange={event => setFilter('maxCost', event.target.value)}/></label>
          <label className="admin-field"><span className="admin-field__label">Min credits</span>
            <input className="admin-input" type="number" min={0} placeholder="0" value={filters.minCredits} onChange={event => setFilter('minCredits', event.target.value)}/></label>
          <label className="admin-field"><span className="admin-field__label">Max credits</span>
            <input className="admin-input" type="number" min={0} placeholder="∞" value={filters.maxCredits} onChange={event => setFilter('maxCredits', event.target.value)}/></label>
          <div className="admin-filters__spacer"/>
          <button className="admin-btn" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
        </div>

        <div className="admin-table-wrap">
          {rows.length === 0 ? (
            <EmptyState icon={<Search size={26}/>} title="No requests match the filters" body="Loosen a range or clear the filters to see the demo request log."/>
          ) : (
            <table className="admin-table admin-table--compact">
              <thead>
                <tr>
                  <th>Request ID</th><th>Timestamp</th><th>Account</th><th>Email</th><th>Provider</th><th>Model</th><th>Type</th>
                  <th className="num">In tok</th><th className="num">Out tok</th><th className="num">Total</th>
                  <th className="num">Resv</th><th className="num">Charged</th><th className="num">Refnd</th>
                  <th className="num">Cost ₹</th><th className="num">Duration</th><th>Status</th><th>Error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(request => {
                  const account = accountById.get(request.accountId)
                  return (
                    <tr key={request.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(request.id)}>
                      <td className="mono">{request.id}</td>
                      <td className="mono">{formatIstDateTime(request.timestamp)}</td>
                      <td><span className="admin-table__primary">{account?.name ?? request.accountId}</span></td>
                      <td className="admin-table__sub">{account?.email ?? '—'}</td>
                      <td>{providers.find(provider => provider.id === request.providerId)?.name ?? request.providerId}</td>
                      <td className="mono">{request.modelId}</td>
                      <td>{REQUEST_TYPE_LABELS[request.type]}</td>
                      <td className="num">{formatNumber(request.inputTokens)}</td>
                      <td className="num">{formatNumber(request.outputTokens)}</td>
                      <td className="num">{formatNumber(request.inputTokens + request.outputTokens)}</td>
                      <td className="num">{formatCredits(request.creditsReserved)}</td>
                      <td className="num">{formatCredits(request.creditsCharged)}</td>
                      <td className="num">{formatCredits(request.creditsRefunded)}</td>
                      <td className="num">{formatInr(request.estimatedCostInr)}</td>
                      <td className="num">{formatDuration(request.durationMs)}</td>
                      <td><RequestStatusBadge status={request.status}/></td>
                      <td className="mono">{request.errorCategory ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} pageCount={pageCount} onPage={setPage} totalLabel={`${filtered.length} requests · page ${page}/${pageCount}`}/>
      </div>

      <RequestDrawer request={selected} onClose={() => setSelectedId(null)}/>
    </div>
  )
}
