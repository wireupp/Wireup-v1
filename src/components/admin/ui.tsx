// Shared presentational building blocks for the admin console.
// Deliberately small and dependency-free apart from lucide + recharts helpers:
// the existing shadcn/base-ui setup is wired to the marketing theme, which this
// console intentionally does not inherit.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Info, Minus, X } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import { formatNumber } from '@/lib/admin/format'
import type { AccountStatus, AlertSeverity, RequestStatus } from '@/lib/admin/types'
import './admin.css'

/* ---------- Stat card ---------- */

export function StatCard({ label, value, delta, deltaLabel, invertDelta, tooltip, foot, icon }: {
  label: string
  value: string
  delta?: number | null
  deltaLabel?: string
  invertDelta?: boolean
  tooltip?: string
  foot?: string
  icon?: ReactNode
}) {
  const deltaClass = delta === null || delta === undefined || Math.abs(delta) < 0.05
    ? 'admin-stat__delta--flat'
    : (delta > 0) !== Boolean(invertDelta) ? 'admin-stat__delta--up' : 'admin-stat__delta--down'
  return (
    <div className="admin-stat" data-tip={tooltip}>
      <span className="admin-stat__label">{icon}{label}</span>
      <span className="admin-stat__value">{value}</span>
      <span className={`admin-stat__delta ${deltaClass}`} data-tip={deltaLabel}>
        {delta === null || delta === undefined || Math.abs(delta) < 0.05
          ? <Minus size={12}/>
          : delta > 0 ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>}
        {delta === null || delta === undefined ? '—' : `${Math.abs(delta).toFixed(1)}%`}
        {deltaLabel && <small>vs {deltaLabel}</small>}
      </span>
      {foot && <span className="admin-stat__foot">{foot}</span>}
    </div>
  )
}

/* ---------- Badges ---------- */

// Status rendering is deliberately understated: a small colored dot plus plain
// text, in the style of Linear/Stripe. No tinted pill backgrounds.

const ACCOUNT_STATUS_COLOR: Record<AccountStatus, { color: string; label: string }> = {
  active: { color: 'var(--a-green)', label: 'Active' },
  suspended: { color: 'var(--a-red)', label: 'Suspended' },
  restricted: { color: 'var(--a-amber)', label: 'Restricted' },
  pending: { color: 'var(--a-faint)', label: 'Pending' },
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const config = ACCOUNT_STATUS_COLOR[status]
  return <span className="admin-badge admin-badge--gray"><span className="admin-dot" style={{ background: config.color }}/>{config.label}</span>
}

const REQUEST_STATUS_COLOR: Record<RequestStatus, { color: string; label: string }> = {
  success: { color: 'var(--a-green)', label: 'Success' },
  failed: { color: 'var(--a-red)', label: 'Failed' },
  rate_limited: { color: 'var(--a-amber)', label: 'Rate limited' },
  cancelled: { color: 'var(--a-faint)', label: 'Cancelled' },
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const config = REQUEST_STATUS_COLOR[status]
  return <span className="admin-badge admin-badge--gray"><span className="admin-dot" style={{ background: config.color }}/>{config.label}</span>
}

const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  info: 'admin-sev--info', warning: 'admin-sev--warning', high: 'admin-sev--high', critical: 'admin-sev--critical',
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return <span className={`admin-sev ${SEVERITY_CLASS[severity]}`}>{severity}</span>
}

export function Badge({ tone = 'admin-badge--gray', children }: { tone?: string; children: ReactNode }) {
  return <span className={`admin-badge ${tone}`}>{children}</span>
}

/* ---------- Modal ---------- */

export function Modal({ open, title, onClose, children, footer, wide }: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <div className="admin-scrim" onClick={onClose} aria-hidden="true"/>
      <div className={`admin-modal__box${wide ? ' admin-modal__box--wide' : ''}`}>
        <div className="admin-modal__head">
          <div className="admin-modal__title">{title}</div>
          <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={onClose} aria-label="Close dialog"><X size={14}/></button>
        </div>
        <div className="admin-modal__body">{children}</div>
        {footer && <div className="admin-modal__foot">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, body, confirmLabel, tone = 'primary', typedConfirmation, onConfirm, onClose }: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  typedConfirmation?: string
  onConfirm: () => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  useEffect(() => { if (open) setTyped('') }, [open])
  const blocked = Boolean(typedConfirmation) && typed !== typedConfirmation
  return (
    <Modal open={open} title={title} onClose={onClose} footer={<>
      <button className="admin-btn" onClick={onClose}>Cancel</button>
      <button className={`admin-btn ${tone === 'danger' ? 'admin-btn--danger' : 'admin-btn--primary'}`} disabled={blocked}
        onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
    </>}>
      <div style={{ color: 'var(--a-text)' }}>{body}</div>
      {typedConfirmation && (
        <label className="admin-field">
          <span className="admin-field__label">Type “{typedConfirmation}” to confirm</span>
          <input className="admin-input" value={typed} onChange={event => setTyped(event.target.value)} autoFocus/>
        </label>
      )}
    </Modal>
  )
}

/* ---------- Drawer ---------- */

export function Drawer({ open, title, sub, onClose, children, footer }: {
  open: boolean
  title: string
  sub?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={title}>
      <div className="admin-scrim" onClick={onClose} aria-hidden="true"/>
      <aside className="admin-drawer" onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
        <div className="admin-drawer__head">
          <div>
            <div className="admin-drawer__title">{title}</div>
            {sub && <div className="admin-drawer__sub">{sub}</div>}
          </div>
          <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={onClose} aria-label="Close panel"><X size={15}/></button>
        </div>
        <div className="admin-drawer__body">{children}</div>
        {footer && <div className="admin-drawer__foot">{footer}</div>}
      </aside>
    </div>
  )
}

export function DrawerSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="admin-drawer-section">
      {title && <h3 className="admin-section-title">{title}</h3>}
      {children}
    </div>
  )
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="admin-kv">
      {rows.map(([label, value]) => <FragmentedKey key={label} label={label} value={value}/>)}
    </dl>
  )
}

function FragmentedKey({ label, value }: { label: string; value: ReactNode }) {
  return <>
    <dt>{label}</dt>
    <dd className={typeof value === 'string' && /^[a-z]+_[a-z0-9]+$/i.test(value) ? 'mono' : undefined}>{value}</dd>
  </>
}

/* ---------- Dropdown menu ---------- */

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  check?: boolean
}

export function Menu({ trigger, items, ariaLabel }: { trigger: ReactNode; items: MenuItem[]; ariaLabel: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="admin-menu-anchor" ref={root}
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      {/* Wrapper only forwards clicks; the trigger element keeps its own role/label. */}
      <span onClick={() => setOpen(value => !value)}>
        {trigger}
      </span>
      {open && (
        <div className="admin-menu" role="menu" aria-label={ariaLabel}>
          {items.map((item, index) => (
            <FragmentedItem key={`${item.label}-${index}`} item={item} close={() => setOpen(false)}/>
          ))}
        </div>
      )}
    </div>
  )
}

function FragmentedItem({ item, close }: { item: MenuItem; close: () => void }) {
  return <>
    {item.separatorBefore && <div className="admin-menu__sep" role="separator"/>}
    <button type="button" role="menuitem" className={`admin-menu__item${item.danger ? ' admin-menu__item--danger' : ''}`}
      disabled={item.disabled}
      onClick={() => { close(); item.onSelect?.() }}>
      {item.check ? <Check size={14}/> : item.icon}
      {item.label}
    </button>
  </>
}

/* ---------- Tabs ---------- */

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="admin-tabs" role="tablist">
      {tabs.map(tab => (
        <button key={tab.key} role="tab" aria-selected={active === tab.key}
          className={`admin-tab${active === tab.key ? ' admin-tab--active' : ''}`}
          onClick={() => onChange(tab.key)}>
          {tab.label}
          {tab.count !== undefined && <span className="admin-tab__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ---------- Pagination ---------- */

export function Pagination({ page, pageCount, onPage, totalLabel }: {
  page: number
  pageCount: number
  onPage: (page: number) => void
  totalLabel: string
}) {
  if (pageCount <= 1) return <div className="admin-pagination"><span className="admin-pagination__info">{totalLabel}</span></div>
  const windowStart = Math.max(1, Math.min(page - 2, pageCount - 4))
  const windowEnd = Math.min(pageCount, windowStart + 4)
  const pages: number[] = []
  for (let index = windowStart; index <= windowEnd; index++) pages.push(index)
  return (
    <div className="admin-pagination">
      <span className="admin-pagination__info">{totalLabel}</span>
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button>
      {windowStart > 1 && <span className="admin-pagination__info">…</span>}
      {pages.map(index => (
        <button key={index} aria-current={index === page} onClick={() => onPage(index)}>{index}</button>
      ))}
      {windowEnd < pageCount && <span className="admin-pagination__info">…</span>}
      <button onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">›</button>
    </div>
  )
}

/* ---------- Empty & loading ---------- */

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="admin-empty">
      {icon}
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {action}
    </div>
  )
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="admin-loading-row" style={{ padding: 16 }} aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} style={{ display: 'flex', gap: 12 }}>
          <div className="admin-skeleton" style={{ width: 130 }}/>
          <div className="admin-skeleton" style={{ flex: 1 }}/>
          <div className="admin-skeleton" style={{ width: 70 }}/>
        </div>
      ))}
    </div>
  )
}

/* ---------- Toasts ---------- */

function ToastItem({ id, title, description, tone }: { id: string; title: string; description?: string; tone: 'success' | 'error' | 'info' }) {
  const dismiss = useAdminStore(state => state.dismissToast)
  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), 4600)
    return () => clearTimeout(timer)
  }, [id, dismiss])
  const icon = tone === 'success' ? <Check size={14} color="var(--a-green)"/> : tone === 'error' ? <AlertTriangle size={14} color="var(--a-red)"/> : <Info size={14} color="var(--a-accent)"/>
  return (
    <div className={`admin-toast admin-toast--${tone}`} role="status">
      <span style={{ marginTop: 2 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div className="admin-toast__title">{title}</div>
        {description && <div className="admin-toast__desc">{description}</div>}
      </div>
      <button className="admin-toast__close" onClick={() => dismiss(id)} aria-label="Dismiss notification"><X size={13}/></button>
    </div>
  )
}

export function Toaster() {
  const toasts = useAdminStore(state => state.toasts)
  if (!toasts.length) return null
  return <div className="admin-toasts">{toasts.map(toast => <ToastItem key={toast.id} {...toast}/>)}</div>
}

/* ---------- Recharts tooltip ---------- */

export interface ChartTooltipEntry { name?: string; value?: number | string; color?: string }

export function ChartTooltip({ active, payload, label, valueFormatter }: {
  active?: boolean
  payload?: ChartTooltipEntry[]
  label?: string | number
  valueFormatter?: (value: number, name: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--a-popover)', border: '1px solid var(--a-line-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, boxShadow: '0 10px 30px rgba(0,0,0,.28)', color: 'var(--a-text)' }}>
      <div style={{ color: 'var(--a-faint)', fontFamily: 'var(--a-mono)', fontSize: 10, marginBottom: 4 }}>{label}</div>
      {payload.map((entry, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--a-text)' }}>
          <span className="admin-dot" style={{ background: entry.color }}/>
          <span style={{ color: 'var(--a-muted)' }}>{entry.name}</span>
          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', paddingLeft: 12 }}>
            {typeof entry.value === 'number' && valueFormatter ? valueFormatter(entry.value, String(entry.name ?? '')) : String(entry.value ?? '')}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Switch ---------- */

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <span className="admin-switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={event => onChange(event.target.checked)}/>
      <span className="admin-switch__track" aria-hidden="true"/>
      <span className="admin-switch__thumb" aria-hidden="true"/>
    </span>
  )
}

/* ---------- Small helpers ---------- */

export function useDebouncedValue<T>(value: T, delay = 220): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function SortHeader({ label, field, sort, onSort, numeric }: {
  label: string
  field: string
  sort: { field: string; dir: 'asc' | 'desc' }
  onSort: (field: string) => void
  numeric?: boolean
}) {
  const active = sort.field === field
  return (
    <th className={`admin-th-sort${numeric ? ' num' : ''}`} onClick={() => onSort(field)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}{active && <span className="admin-th-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )
}

export function toggleSort(current: { field: string; dir: 'asc' | 'desc' }, field: string): { field: string; dir: 'asc' | 'desc' } {
  if (current.field === field) return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { field, dir: 'desc' }
}

export function formatRangeLabel(count: number, singular: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : `${singular}s`}`
}
