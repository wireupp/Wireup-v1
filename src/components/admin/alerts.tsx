import { useMemo, useState } from 'react'
import { BellOff, Check, CheckCheck, Eye, Search, X } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import { formatIstDateTime, relativeTime } from '@/lib/admin/format'
import { ALERT_KIND_LABELS } from '@/lib/admin/types'
import type { AlertKind, AlertRecord, AlertSeverity, AlertStatus } from '@/lib/admin/types'
import { AccountStatusBadge, EmptyState, Menu, Modal, SeverityBadge } from './ui'
import { RequestDrawer } from './request-drawer'

export function AlertsPage() {
  const alerts = useAdminStore(state => state.alerts)
  const accounts = useAdminStore(state => state.accounts)
  const requests = useAdminStore(state => state.requests)
  const markAlertRead = useAdminStore(state => state.markAlertRead)
  const acknowledgeAlert = useAdminStore(state => state.acknowledgeAlert)
  const resolveAlert = useAdminStore(state => state.resolveAlert)
  const dismissAlert = useAdminStore(state => state.dismissAlert)

  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<AlertStatus | 'open' | 'all'>('open')
  const [search, setSearch] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return alerts.filter(alert => {
      if (severityFilter !== 'all' && alert.severity !== severityFilter) return false
      if (statusFilter === 'open' && (alert.status === 'resolved' || alert.status === 'dismissed')) return false
      if (statusFilter !== 'open' && statusFilter !== 'all' && alert.status !== statusFilter) return false
      if (needle) {
        const account = alert.accountId ? accounts.find(item => item.id === alert.accountId) : null
        const haystack = `${alert.title} ${alert.description} ${ALERT_KIND_LABELS[alert.kind]} ${account?.name ?? ''} ${account?.email ?? ''}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [alerts, severityFilter, statusFilter, search, accounts])

  const detail = detailId ? alerts.find(alert => alert.id === detailId) ?? null : null
  const detailAccount = detail?.accountId ? accounts.find(account => account.id === detail.accountId) : null
  const detailRequest = requestId ? requests.find(request => request.id === requestId) ?? null : null
  const counts = useMemo(() => ({
    open: alerts.filter(alert => alert.status !== 'resolved' && alert.status !== 'dismissed').length,
    critical: alerts.filter(alert => alert.severity === 'critical' && alert.status !== 'resolved' && alert.status !== 'dismissed').length,
  }), [alerts])

  const openDetail = (alert: AlertRecord) => { markAlertRead(alert.id); setDetailId(alert.id) }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Alerts & anomaly monitoring</h2>
          <p>{counts.open} open · {counts.critical} critical · all alerts come from deterministic demo rules, not a real anomaly detector.</p>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-filters">
          <label className="admin-field" style={{ minWidth: 200 }}>
            <span className="admin-field__label">Search</span>
            <input className="admin-input" placeholder="Title, description, account…" value={search} onChange={event => setSearch(event.target.value)}/>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Severity</span>
            <select className="admin-select" value={severityFilter} onChange={event => setSeverityFilter(event.target.value as AlertSeverity | 'all')}>
              <option value="all">All severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Status</span>
            <select className="admin-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value as AlertStatus | 'open' | 'all')}>
              <option value="open">Open (unread + acknowledged)</option>
              <option value="unread">Unread</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All</option>
            </select>
          </label>
          <div className="admin-filters__spacer"/>
          <span className="admin-table-count">{filtered.length} shown</span>
        </div>

        <div>
          {filtered.length === 0 ? <EmptyState icon={<BellOff size={26}/>} title="No alerts match" body="Change the severity or status filters to see the simulated alert history."/> : filtered.map(alert => {
            const account = alert.accountId ? accounts.find(item => item.id === alert.accountId) : null
            return (
              <div key={alert.id} className={`admin-alert-row${alert.status === 'resolved' || alert.status === 'dismissed' ? ' admin-alert-row--dim' : ''}`}>
                <div className="admin-alert-row__body" style={{ cursor: 'pointer' }} onClick={() => openDetail(alert)}>
                  <div className="admin-alert-row__title">
                    <SeverityBadge severity={alert.severity}/>
                    {alert.title}
                    {!alert.readAt && alert.status === 'unread' && <span className="admin-dot" style={{ background: 'var(--a-accent)' }} title="Unread"/>}
                    {account && <AccountStatusBadge status={account.status}/>}
                  </div>
                  <div className="admin-alert-row__desc">{alert.description}</div>
                  <div className="admin-alert-row__meta">
                    <span>{ALERT_KIND_LABELS[alert.kind]}</span>
                    <span>{formatIstDateTime(alert.createdAt)} · {relativeTime(alert.createdAt)}</span>
                    {alert.metric && <span>metric: {alert.metric}</span>}
                    <span>status: {alert.status}</span>
                  </div>
                </div>
                <Menu ariaLabel={`Actions for "${alert.title}"`} trigger={<button className="admin-btn admin-btn--sm" aria-label={`Actions for "${alert.title}"`}>Actions</button>} items={[
                  { label: 'Mark as read', icon: <Eye size={13}/>, disabled: Boolean(alert.readAt), onSelect: () => markAlertRead(alert.id) },
                  { label: 'Acknowledge', icon: <Check size={13}/>, disabled: alert.status === 'acknowledged' || alert.status === 'resolved', onSelect: () => acknowledgeAlert(alert.id) },
                  { label: 'Resolve', icon: <CheckCheck size={13}/>, disabled: alert.status === 'resolved', onSelect: () => resolveAlert(alert.id) },
                  { label: 'Dismiss', icon: <X size={13}/>, danger: true, separatorBefore: true, disabled: alert.status === 'dismissed', onSelect: () => dismissAlert(alert.id) },
                ]}/>
              </div>
            )
          })}
        </div>
      </div>

      <Modal open={Boolean(detail)} title={detail?.title ?? ''} onClose={() => { setDetailId(null); setRequestId(null) }} wide footer={
        <>
          <button className="admin-btn" onClick={() => { if (detail) acknowledgeAlert(detail.id); setDetailId(null) }}>Acknowledge</button>
          <button className="admin-btn admin-btn--primary" onClick={() => { if (detail) resolveAlert(detail.id); setDetailId(null) }}>Resolve</button>
        </>
      }>
        {detail && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <SeverityBadge severity={detail.severity}/>
              <span className="admin-badge admin-badge--gray">{detail.status}</span>
              <span className="admin-sim-tag">simulated rule</span>
            </div>
            <p style={{ color: 'var(--a-text)' }}>{detail.description}</p>
            <dl className="admin-kv">
              <dt>Alert ID</dt><dd className="mono">{detail.id}</dd>
              <dt>Kind</dt><dd>{ALERT_KIND_LABELS[detail.kind as AlertKind]}</dd>
              <dt>Created</dt><dd>{formatIstDateTime(detail.createdAt)}</dd>
              <dt>Metric</dt><dd>{detail.metric ?? '—'}</dd>
              <dt>Account</dt><dd>{detailAccount ? `${detailAccount.name} (${detailAccount.email})` : '—'}</dd>
            </dl>
            {detail.requestId && (
              <button className="admin-btn" onClick={() => setRequestId(detail.requestId!)}>Open related request {detail.requestId}</button>
            )}
            <div className="admin-note">
              <Search size={13}/>
              <span>Demo alert history is static seed data plus actions you take here. Production anomaly monitoring must run server-side with real usage streams.</span>
            </div>
          </>
        )}
      </Modal>

      <RequestDrawer request={detailRequest} onClose={() => setRequestId(null)}/>
    </div>
  )
}
