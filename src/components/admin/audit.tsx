import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import { formatIstDateTime } from '@/lib/admin/format'
import { buildCsv, downloadCsv } from '@/lib/admin/csv'
import { AUDIT_ACTION_LABELS } from '@/lib/admin/types'
import type { AuditAction, AuditEvent } from '@/lib/admin/types'
import { Badge, EmptyState, Pagination, SortHeader, toggleSort, useDebouncedValue } from './ui'

const PAGE_SIZE = 15

const ACTION_TONES: Partial<Record<AuditAction, string>> = {
  'account.suspended': 'admin-badge--red',
  'account.restricted': 'admin-badge--amber',
  'account.activated': 'admin-badge--green',
  'account.restored': 'admin-badge--green',
  'credits.granted': 'admin-badge--green',
  'credits.deducted': 'admin-badge--red',
  'credits.promotional_granted': 'admin-badge--violet',
  'pricing.changed': 'admin-badge--blue',
  'ratelimits.changed': 'admin-badge--blue',
  'settings.updated': 'admin-badge--blue',
  'reset.daily_triggered': 'admin-badge--amber',
}

export function AuditPage() {
  const auditEvents = useAdminStore(state => state.auditEvents)
  const [search, setSearch] = useState('')
  const [adminFilter, setAdminFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState<AuditAction | 'all'>('all')
  const [resourceFilter, setResourceFilter] = useState<'all' | AuditEvent['targetType']>('all')
  const [dateFilter, setDateFilter] = useState('')
  const [sort, setSort] = useState({ field: 'timestamp', dir: 'desc' as 'asc' | 'desc' })
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { setPage(1) }, [adminFilter, actionFilter, resourceFilter, dateFilter, debouncedSearch])

  const admins = useMemo(() => Array.from(new Set(auditEvents.map(event => event.admin))).sort(), [auditEvents])
  const filtered = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase()
    return auditEvents.filter(event => {
      if (adminFilter !== 'all' && event.admin !== adminFilter) return false
      if (actionFilter !== 'all' && event.action !== actionFilter) return false
      if (resourceFilter !== 'all' && event.targetType !== resourceFilter) return false
      if (dateFilter && !event.timestamp.startsWith(dateFilter)) return false
      if (needle) {
        const haystack = `${event.id} ${event.targetLabel} ${event.targetId} ${event.reason ?? ''} ${event.before ?? ''} ${event.after ?? ''} ${AUDIT_ACTION_LABELS[event.action]}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    }).sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      if (sort.field === 'timestamp') return (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * dir
      if (sort.field === 'admin') return a.admin.localeCompare(b.admin) * dir
      return a.action.localeCompare(b.action) * dir
    })
  }, [auditEvents, adminFilter, actionFilter, resourceFilter, dateFilter, debouncedSearch, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const exportCsv = () => {
    const csv = buildCsv(filtered, [
      { header: 'Event ID', value: (event: AuditEvent) => event.id },
      { header: 'Timestamp (IST)', value: event => formatIstDateTime(event.timestamp) },
      { header: 'Administrator', value: event => event.admin },
      { header: 'Action', value: event => event.action },
      { header: 'Resource type', value: event => event.targetType },
      { header: 'Target', value: event => event.targetLabel },
      { header: 'Target ID', value: event => event.targetId },
      { header: 'Before', value: event => event.before ?? '' },
      { header: 'After', value: event => event.after ?? '' },
      { header: 'Reason', value: event => event.reason ?? '' },
    ])
    downloadCsv(`wireup-audit-log-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Audit logs</h2>
          <p>{auditEvents.length} events · every admin action in this console appends an entry automatically. Immutability must be enforced server-side in production.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn" onClick={exportCsv}><Download size={13}/>Export CSV</button>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-filters">
          <label className="admin-field" style={{ minWidth: 200 }}>
            <span className="admin-field__label">Search</span>
            <input className="admin-input" placeholder="Target, reason, event ID…" value={search} onChange={event => setSearch(event.target.value)}/>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Administrator</span>
            <select className="admin-select" value={adminFilter} onChange={event => setAdminFilter(event.target.value)}>
              <option value="all">All administrators</option>
              {admins.map(admin => <option key={admin} value={admin}>{admin}</option>)}
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Action</span>
            <select className="admin-select" value={actionFilter} onChange={event => setActionFilter(event.target.value as AuditAction | 'all')}>
              <option value="all">All actions</option>
              {(Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map(action => <option key={action} value={action}>{AUDIT_ACTION_LABELS[action]}</option>)}
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Resource</span>
            <select className="admin-select" value={resourceFilter} onChange={event => setResourceFilter(event.target.value as 'all' | AuditEvent['targetType'])}>
              <option value="all">All resources</option>
              <option value="account">Account</option>
              <option value="model">Model</option>
              <option value="provider">Provider</option>
              <option value="platform">Platform</option>
              <option value="alert">Alert</option>
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Date (IST)</span>
            <input className="admin-input" type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)}/>
          </label>
          <div className="admin-filters__spacer"/>
          <span className="admin-table-count">{filtered.length} events</span>
        </div>

        <div className="admin-table-wrap">
          {rows.length === 0 ? <EmptyState title="No audit events match" body="Try clearing filters — or perform an action in another section and come back."/> : (
            <table className="admin-table">
              <thead>
                <tr>
                  <SortHeader label="Timestamp" field="timestamp" sort={sort} onSort={field => setSort(toggleSort(sort, field))}/>
                  <SortHeader label="Administrator" field="admin" sort={sort} onSort={field => setSort(toggleSort(sort, field))}/>
                  <SortHeader label="Action" field="action" sort={sort} onSort={field => setSort(toggleSort(sort, field))}/>
                  <th>Target</th><th>Before → after</th><th>Reason</th><th>Event ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(event => (
                  <tr key={event.id}>
                    <td className="mono">{formatIstDateTime(event.timestamp)}</td>
                    <td>{event.admin}</td>
                    <td><Badge tone={ACTION_TONES[event.action] ?? 'admin-badge--gray'}>{AUDIT_ACTION_LABELS[event.action]}</Badge></td>
                    <td><span className="admin-table__primary">{event.targetLabel}</span><div className="admin-table__sub">{event.targetType}</div></td>
                    <td className="admin-table__sub">{event.before ?? '—'} → {event.after ?? '—'}</td>
                    <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={event.reason ?? ''}>{event.reason ?? '—'}</td>
                    <td className="mono">{event.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} pageCount={pageCount} onPage={setPage} totalLabel={`${filtered.length} events · page ${page}/${pageCount}`}/>
      </div>
    </div>
  )
}
