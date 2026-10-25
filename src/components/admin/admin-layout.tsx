import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, BadgeCheck, Bell, Coins, Cpu, FileDown, Gauge,
  LayoutDashboard, LogOut, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, RefreshCw,
  ScrollText, Search, Settings as SettingsIcon, ShieldAlert, Users, X,
} from 'lucide-react'
import { DEMO_ADMIN, useAdminStore } from '@/lib/admin/store'
import { relativeTime } from '@/lib/admin/format'
import { PERIOD_LABELS } from '@/lib/admin/types'
import type { PeriodKey } from '@/lib/admin/types'
import { Menu, Modal, SeverityBadge, Toaster } from './ui'
import { useAdminTheme, usePeriod } from './admin-app'

const NAV_SECTIONS: { section: string; items: { to: string; label: string; icon: React.ReactNode; badge?: 'alerts' }[] }[] = [
  {
    section: 'Monitor',
    items: [
      { to: '/admin', label: 'Overview', icon: <LayoutDashboard size={15}/> },
      { to: '/admin/usage', label: 'AI Usage', icon: <Activity size={15}/> },
      { to: '/admin/tokens', label: 'Token Analytics', icon: <Coins size={15}/> },
    ],
  },
  {
    section: 'Manage',
    items: [
      { to: '/admin/accounts', label: 'Accounts', icon: <Users size={15}/> },
      { to: '/admin/credits', label: 'Credits & Limits', icon: <BadgeCheck size={15}/> },
      { to: '/admin/models', label: 'Models & Providers', icon: <Cpu size={15}/> },
      { to: '/admin/rate-limits', label: 'Rate Limits', icon: <Gauge size={15}/> },
    ],
  },
  {
    section: 'Operate',
    items: [
      { to: '/admin/alerts', label: 'Alerts', icon: <ShieldAlert size={15}/>, badge: 'alerts' },
      { to: '/admin/audit', label: 'Audit Logs', icon: <ScrollText size={15}/> },
      { to: '/admin/reports', label: 'Reports', icon: <FileDown size={15}/> },
      { to: '/admin/settings', label: 'Settings', icon: <SettingsIcon size={15}/> },
    ],
  },
]

const PAGE_TITLES: Record<string, { title: string; section: string }> = {
  '/admin': { title: 'Overview', section: 'Monitor' },
  '/admin/usage': { title: 'AI Usage', section: 'Monitor' },
  '/admin/tokens': { title: 'Token Analytics', section: 'Monitor' },
  '/admin/accounts': { title: 'Accounts', section: 'Manage' },
  '/admin/credits': { title: 'Credits & Limits', section: 'Manage' },
  '/admin/models': { title: 'Models & Providers', section: 'Manage' },
  '/admin/rate-limits': { title: 'Rate Limits', section: 'Manage' },
  '/admin/alerts': { title: 'Alerts', section: 'Operate' },
  '/admin/audit': { title: 'Audit Logs', section: 'Operate' },
  '/admin/reports': { title: 'Reports', section: 'Operate' },
  '/admin/settings': { title: 'Settings', section: 'Operate' },
}

function GlobalSearch() {
  const accounts = useAdminStore(state => state.accounts)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    return accounts
      .filter(account => account.name.toLowerCase().includes(needle) || account.email.toLowerCase().includes(needle) || account.id.toLowerCase().includes(needle))
      .slice(0, 7)
  }, [accounts, query])
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  return (
    <div className="admin-topbar__search admin-menu-anchor" ref={root}>
      <Search size={14}/>
      <input role="searchbox" aria-label="Search accounts" placeholder="Search accounts…"
        value={query} onChange={event => { setQuery(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}/>
      {open && query.trim().length >= 2 && (
        <div className="admin-menu" role="listbox" aria-label="Account results" style={{ left: 0, right: 'auto', width: 300 }}>
          <div className="admin-menu__label">Accounts</div>
          {matches.length === 0 && <div className="admin-menu__item" style={{ color: 'var(--a-faint)' }}>No accounts match “{query}”</div>}
          {matches.map(account => (
            <button key={account.id} className="admin-menu__item" role="option" aria-selected={false}
              onClick={() => { setOpen(false); setQuery(''); navigate(`/admin/accounts?q=${encodeURIComponent(account.email)}`) }}>
              <Users size={13}/>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.name} · {account.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NotificationBell() {
  const alerts = useAdminStore(state => state.alerts)
  const markAlertRead = useAdminStore(state => state.markAlertRead)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const unread = alerts.filter(alert => alert.status === 'unread' && !alert.readAt)
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  return (
    <div className="admin-menu-anchor" ref={root}>
      <button className="admin-topbar__icon-btn" aria-label={`Notifications (${unread.length} unread)`} aria-expanded={open}
        onClick={() => setOpen(value => !value)}>
        <Bell size={15}/>
        {unread.length > 0 && <span className="admin-topbar__dot">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>
      {open && (
        <div className="admin-menu" style={{ width: 330, maxWidth: '92vw', left: 'auto', right: 0 }} role="dialog" aria-label="Notifications">
          <div className="admin-menu__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Unread alerts</span>
            <Link to="/admin/alerts" onClick={() => setOpen(false)} style={{ color: 'var(--a-accent)' }}>View all</Link>
          </div>
          {unread.length === 0 && <div className="admin-notif-item"><div className="admin-notif-item__body"><div className="admin-notif-item__desc">You're all caught up.</div></div></div>}
          {unread.slice(0, 5).map(alert => (
            <div key={alert.id} className="admin-notif-item">
              <div className="admin-notif-item__body">
                <div className="admin-notif-item__title"><SeverityBadge severity={alert.severity}/>{alert.title}</div>
                <div className="admin-notif-item__desc">{alert.description}</div>
                <div className="admin-notif-item__time">{relativeTime(alert.createdAt)} · {alert.metric}</div>
              </div>
              <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => markAlertRead(alert.id)} aria-label={`Mark "${alert.title}" as read`}>Read</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { period, setPeriod } = usePeriod()
  const { theme, themeDef } = useAdminTheme()
  const alerts = useAdminStore(state => state.alerts)
  const refreshData = useAdminStore(state => state.refreshData)
  const pushToast = useAdminStore(state => state.pushToast)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('wireup.admin.nav-collapsed') === '1' } catch { return false } })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const unreadCount = alerts.filter(alert => alert.status === 'unread' && !alert.readAt).length
  const meta = PAGE_TITLES[location.pathname] ?? { title: 'Overview', section: 'Monitor' }

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])
  useEffect(() => { try { localStorage.setItem('wireup.admin.nav-collapsed', collapsed ? '1' : '0') } catch { /* ignore */ } }, [collapsed])

  const refresh = () => {
    setSpinning(true)
    refreshData()
    setTimeout(() => setSpinning(false), 700)
  }

  const sidebar = (
    <aside className={`admin-sidebar${drawerOpen ? ' admin-sidebar--open' : ''}`}>
      <div className="admin-sidebar__brand">
        <img src="/wireup-logo.png" alt=""/>
        <div>
          <div className="admin-sidebar__brand-name">WireUp</div>
          <div className="admin-sidebar__brand-sub">Admin console</div>
        </div>
        <button className="admin-btn admin-btn--ghost admin-btn--sm" style={{ marginLeft: 'auto' }} aria-label="Close navigation" onClick={() => setDrawerOpen(false)}><X size={14}/></button>
      </div>
      <nav className="admin-nav" aria-label="Admin sections">
        {NAV_SECTIONS.map(group => (
          <div key={group.section}>
            <div className="admin-nav__section">{group.section}</div>
            {group.items.map(item => {
              const active = item.to === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(item.to)
              return (
                <Link key={item.to} to={item.to} className={`admin-nav-item${active ? ' admin-nav-item--active' : ''}`} aria-current={active ? 'page' : undefined}>
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge === 'alerts' && unreadCount > 0 && <span className="admin-nav-item__count">{unreadCount}</span>}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="admin-sidebar__foot">
        <Menu ariaLabel="Admin profile menu" trigger={
          <span className="admin-sidebar__profile" style={{ display: 'flex', width: '100%' }} role="button" tabIndex={0}>
            <span className="admin-avatar">{DEMO_ADMIN.name.split(' ').map(part => part[0]).join('')}</span>
            <span>
              <span className="admin-sidebar__profile-name" style={{ display: 'block' }}>{DEMO_ADMIN.name}</span>
              <span className="admin-sidebar__profile-role">{DEMO_ADMIN.role}</span>
            </span>
          </span>
        } items={[
          { label: 'View profile', icon: <Users size={14}/>, onSelect: () => setProfileOpen(true) },
          { label: 'Console settings', icon: <SettingsIcon size={14}/>, onSelect: () => navigate('/admin/settings') },
          { label: 'Sign out (simulated)', icon: <LogOut size={14}/>, danger: true, separatorBefore: true, onSelect: () => pushToast({ title: 'Sign-out simulated', tone: 'info', description: 'Demo mode: authentication is not wired to a backend yet.' }) },
        ]}/>
        <button className="admin-btn admin-btn--ghost admin-btn--sm admin-sidebar__collapse" onClick={() => setCollapsed(value => !value)}>
          {collapsed ? <PanelLeftOpen size={13}/> : <PanelLeftClose size={13}/>}<span>Collapse</span>
        </button>
      </div>
    </aside>
  )

  return (
    <div data-theme={theme} className={`admin-app${collapsed ? ' admin-app--nav-collapsed' : ''}${themeDef.kind !== 'dark' ? ' admin-app--content-light' : ''}${themeDef.kind === 'white' ? ' admin-app--chrome-light' : ''}`}>
      {sidebar}
      {drawerOpen && <div className="admin-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true"/>}
      <div className="admin-main">
        <header className="admin-topbar">
          <button className="admin-topbar__icon-btn admin-burger" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}><MenuIcon size={15}/></button>
          <div className="admin-topbar__titles">
            <div className="admin-topbar__crumb">Admin / {meta.section}</div>
            <div className="admin-topbar__title">{meta.title}</div>
          </div>
          <div className="admin-topbar__spacer"/>
          <GlobalSearch/>
          <select className="admin-select" style={{ width: 128 }} aria-label="Time period"
            value={period} onChange={event => setPeriod(event.target.value as PeriodKey)}>
            {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map(key => <option key={key} value={key}>{PERIOD_LABELS[key]}</option>)}
          </select>
          <span className="admin-demo-pill" title="All data on this console is synthetic. No backend, Firebase or Sarvam AI connection is active."><span>DEMO MODE</span></span>
          <NotificationBell/>
          <button className={`admin-topbar__icon-btn${spinning ? ' admin-topbar__icon-btn--spin' : ''}`} aria-label="Refresh dashboard data" onClick={refresh}>
            <RefreshCw size={15}/>
          </button>
        </header>
        <main className="admin-content" id="admin-main">
          <Outlet/>
        </main>
      </div>
      <Toaster/>
      <Modal open={profileOpen} title="Administrator profile" onClose={() => setProfileOpen(false)} footer={
        <button className="admin-btn" onClick={() => setProfileOpen(false)}>Close</button>
      }>
        <p>This is the mock profile for the demo administrator. In production this identity comes from Firebase Authentication with a custom admin claim, and every action here would be authenticated server-side.</p>
        <dl className="admin-kv">
          <dt>Name</dt><dd>{DEMO_ADMIN.name}</dd>
          <dt>Email</dt><dd>{DEMO_ADMIN.email}</dd>
          <dt>Role</dt><dd>{DEMO_ADMIN.role}</dd>
          <dt>Auth</dt><dd>Simulated — not connected</dd>
        </dl>
      </Modal>
    </div>
  )
}
