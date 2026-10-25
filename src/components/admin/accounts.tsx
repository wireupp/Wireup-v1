import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Ban, CheckCircle2, Download, List, Rows3, ShieldOff, Table2 } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import { formatCredits, formatDayKeyLong, formatIstDate, formatNumber, relativeTime } from '@/lib/admin/format'
import { buildCsv, downloadCsv } from '@/lib/admin/csv'
import type { Account, AccountRole, AccountStatus } from '@/lib/admin/types'
import { AccountStatusBadge, Badge, EmptyState, Menu, Pagination, SortHeader, toggleSort, useDebouncedValue } from './ui'
import { AccountDrawer } from './account-drawer'
import { CreditAdjustDialog } from './credit-adjust-dialog'

const PAGE_SIZE = 12
const ROLE_LABELS: Record<AccountRole, string> = { user: 'User', pro: 'Pro', team: 'Team', admin: 'Administrator' }

function usageTone(used: number, limit: number): string {
  const percent = limit > 0 ? (used / limit) * 100 : 0
  return percent >= 90 ? 'admin-bar-cell__fill--crit' : percent >= 70 ? 'admin-bar-cell__fill--warn' : ''
}

export function AccountsPage() {
  const accounts = useAdminStore(state => state.accounts)
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [statusFilter, setStatusFilter] = useState<AccountStatus | 'all'>('all')
  const [roleFilter, setRoleFilter] = useState<AccountRole | 'all'>('all')
  const [sort, setSort] = useState({ field: 'lastActiveAt', dir: 'desc' as 'asc' | 'desc' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openAccountId, setOpenAccountId] = useState<string | null>(null)
  const [bulkDialog, setBulkDialog] = useState<'grant' | 'deduct' | 'promotional' | null>(null)
  const [compactView, setCompactView] = useState(false)
  const debouncedSearch = useDebouncedValue(search)

  useEffect(() => { setPage(1) }, [statusFilter, roleFilter, debouncedSearch])

  const filtered = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase()
    const rows = accounts.filter(account => {
      if (needle && !(account.name.toLowerCase().includes(needle) || account.email.toLowerCase().includes(needle) || account.id.toLowerCase().includes(needle))) return false
      if (statusFilter !== 'all' && account.status !== statusFilter) return false
      if (roleFilter !== 'all' && account.role !== roleFilter) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    return rows.sort((a, b) => {
      switch (sort.field) {
        case 'name': return a.name.localeCompare(b.name) * dir
        case 'status': return a.status.localeCompare(b.status) * dir
        case 'role': return a.role.localeCompare(b.role) * dir
        case 'createdAt': return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
        case 'lastActiveAt': return (new Date(a.lastActiveAt).getTime() - new Date(b.lastActiveAt).getTime()) * dir
        case 'requests': return (a.usage.lifetimeRequests - b.usage.lifetimeRequests) * dir
        case 'tokens': return ((a.usage.lifetimeInputTokens + a.usage.lifetimeOutputTokens) - (b.usage.lifetimeInputTokens + b.usage.lifetimeOutputTokens)) * dir
        case 'balance': return ((a.balances.daily + a.balances.permanent + a.balances.promotional) - (b.balances.daily + b.balances.permanent + b.balances.promotional)) * dir
        case 'daily': return (a.usage.dailyCreditsUsed - b.usage.dailyCreditsUsed) * dir
        case 'monthly': return (a.usage.monthlyCreditsUsed - b.usage.monthlyCreditsUsed) * dir
        default: return 0
      }
    })
  }, [accounts, debouncedSearch, statusFilter, roleFilter, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selectedAccounts = accounts.filter(account => selected.has(account.id))
  const allPageSelected = pageRows.length > 0 && pageRows.every(account => selected.has(account.id))

  const toggleRow = (id: string) => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const togglePage = () => {
    setSelected(previous => {
      const next = new Set(previous)
      if (allPageSelected) pageRows.forEach(account => next.delete(account.id))
      else pageRows.forEach(account => next.add(account.id))
      return next
    })
  }

  const exportCsv = () => {
    const csv = buildCsv(filtered, [
      { header: 'Account ID', value: (account: Account) => account.id },
      { header: 'Name', value: account => account.name },
      { header: 'Email', value: account => account.email },
      { header: 'Organization', value: account => account.organization },
      { header: 'Status', value: account => account.status },
      { header: 'Role', value: account => account.role },
      { header: 'AI access', value: account => (account.aiEnabled ? 'enabled' : 'disabled') },
      { header: 'Registered', value: account => account.createdAt },
      { header: 'Last active', value: account => account.lastActiveAt },
      { header: 'Total requests', value: account => account.usage.lifetimeRequests },
      { header: 'Total tokens', value: account => account.usage.lifetimeInputTokens + account.usage.lifetimeOutputTokens },
      { header: 'Credits daily', value: account => account.balances.daily },
      { header: 'Credits permanent', value: account => account.balances.permanent },
      { header: 'Credits promotional', value: account => account.balances.promotional },
      { header: 'Daily usage', value: account => account.usage.dailyCreditsUsed },
      { header: 'Monthly usage', value: account => account.usage.monthlyCreditsUsed },
      { header: 'Daily limit', value: account => account.limits.daily },
      { header: 'Monthly limit', value: account => account.limits.monthly },
    ])
    downloadCsv(`wireup-accounts-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const bulkSuspend = () => {
    const setAccountStatus = useAdminStore.getState().setAccountStatus
    for (const account of selectedAccounts) if (account.status === 'active' || account.status === 'pending') setAccountStatus(account.id, 'suspended', `Bulk suspend (${selectedAccounts.length} accounts)`)
    setSelected(new Set())
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Accounts</h2>
          <p>{formatNumber(accounts.length)} accounts · {filtered.length} match the current filters</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn" onClick={() => setCompactView(value => !value)}>
            {compactView ? <><Table2 size={13}/>Table view</> : <><List size={13}/>Compact view</>}
          </button>
          <button className="admin-btn" onClick={exportCsv}><Download size={13}/>Export CSV</button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="admin-card admin-card__body" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
          <strong style={{ fontSize: 12.5 }}>{selected.size} selected</strong>
          <button className="admin-btn admin-btn--sm" onClick={() => setBulkDialog('grant')}>Grant credits</button>
          <button className="admin-btn admin-btn--sm" onClick={() => setBulkDialog('deduct')}>Deduct credits</button>
          <button className="admin-btn admin-btn--sm" onClick={() => setBulkDialog('promotional')}>Promo credits</button>
          <button className="admin-btn admin-btn--sm admin-btn--danger" onClick={bulkSuspend}><Ban size={12}/>Suspend selected</button>
          <button className="admin-btn admin-btn--sm admin-btn--ghost" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-filters">
          <label className="admin-field" style={{ minWidth: 220 }}>
            <span className="admin-field__label">Search</span>
            <input className="admin-input" placeholder="Name, email or user ID…" value={search} onChange={event => setSearch(event.target.value)}/>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Status</span>
            <select className="admin-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value as AccountStatus | 'all')}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="restricted">Restricted</option>
              <option value="pending">Pending</option>
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Role</span>
            <select className="admin-select" value={roleFilter} onChange={event => setRoleFilter(event.target.value as AccountRole | 'all')}>
              <option value="all">All roles</option>
              <option value="user">User</option>
              <option value="pro">Pro</option>
              <option value="team">Team</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <div className="admin-filters__spacer"/>
          <button className="admin-btn" onClick={() => { setSearch(''); setStatusFilter('all'); setRoleFilter('all') }}>Clear filters</button>
        </div>

        <div className="admin-table-wrap">
          {pageRows.length === 0 ? <EmptyState title="No accounts match" body="Try clearing the search or filters."/> : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}><input type="checkbox" aria-label="Select all on page" checked={allPageSelected} onChange={togglePage} style={{ accentColor: 'var(--a-accent)' }}/></th>
                  <SortHeader label="Account" field="name" sort={sort} onSort={field => setSort(toggleSort(sort, field))}/>
                  <th>Email</th>
                  <th>User ID</th>
                  <SortHeader label="Status" field="status" sort={sort} onSort={field => setSort(toggleSort(sort, field))}/>
                  <SortHeader label="Role" field="role" sort={sort} onSort={field => setSort(toggleSort(sort, field))}/>
                  <SortHeader label="Registered" field="createdAt" sort={sort} onSort={field => setSort(toggleSort(sort, field))}/>
                  <SortHeader label="Last active" field="lastActiveAt" sort={sort} onSort={field => setSort(toggleSort(sort, field))}/>
                  <SortHeader label="Requests" field="requests" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
                  <SortHeader label="Tokens" field="tokens" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
                  <SortHeader label="Balance" field="balance" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
                  <SortHeader label="Daily usage" field="daily" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
                  <SortHeader label="Monthly usage" field="monthly" sort={sort} onSort={field => setSort(toggleSort(sort, field))} numeric/>
                  <th/>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(account => {
                  const totalTokens = account.usage.lifetimeInputTokens + account.usage.lifetimeOutputTokens
                  const balance = account.balances.daily + account.balances.permanent + account.balances.promotional
                  const dailyPercent = account.limits.daily > 0 ? (account.usage.dailyCreditsUsed / account.limits.daily) * 100 : 0
                  const monthlyPercent = account.limits.monthly > 0 ? (account.usage.monthlyCreditsUsed / account.limits.monthly) * 100 : 0
                  if (compactView) {
                    return (
                      <tr key={account.id} style={{ cursor: 'pointer' }} onClick={() => setOpenAccountId(account.id)}>
                        <td><input type="checkbox" aria-label={`Select ${account.name}`} checked={selected.has(account.id)} onClick={event => event.stopPropagation()} onChange={() => toggleRow(account.id)} style={{ accentColor: 'var(--a-accent)' }}/></td>
                        <td><span className="admin-table__primary">{account.name}</span><div className="admin-table__sub">{account.email}</div></td>
                        <td><AccountStatusBadge status={account.status}/></td>
                        <td className="num">{formatCredits(balance)}</td>
                        <td>
                          <div className="admin-bar-cell">
                            <div className="admin-bar-cell__track"><div className={`admin-bar-cell__fill ${usageTone(account.usage.dailyCreditsUsed, account.limits.daily)}`} style={{ width: `${Math.min(100, dailyPercent)}%` }}/></div>
                            <span className="admin-bar-cell__pct">{dailyPercent.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="num">{formatCredits(account.usage.monthlyCreditsUsed)}</td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={account.id} style={{ cursor: 'pointer' }} onClick={() => setOpenAccountId(account.id)}>
                      <td><input type="checkbox" aria-label={`Select ${account.name}`} checked={selected.has(account.id)} onClick={event => event.stopPropagation()} onChange={() => toggleRow(account.id)} style={{ accentColor: 'var(--a-accent)' }}/></td>
                      <td><span className="admin-table__primary">{account.name}</span><div className="admin-table__sub">{account.organization}</div></td>
                      <td>{account.email}</td>
                      <td className="mono">{account.id}</td>
                      <td><AccountStatusBadge status={account.status}/></td>
                      <td><Badge tone={account.role === 'admin' ? 'admin-badge--violet' : 'admin-badge--gray'}>{ROLE_LABELS[account.role]}</Badge></td>
                      <td>{formatIstDate(account.createdAt)}</td>
                      <td title={formatIstDate(account.lastActiveAt)}>{relativeTime(account.lastActiveAt)}</td>
                      <td className="num">{formatNumber(account.usage.lifetimeRequests)}</td>
                      <td className="num">{formatNumber(totalTokens)}</td>
                      <td className="num">{formatCredits(balance)}</td>
                      <td>
                        <div className="admin-bar-cell" title={`${formatCredits(account.usage.dailyCreditsUsed)} of ${formatCredits(account.limits.daily)} · period ${account.dailyPeriodId || '—'}`}>
                          <div className="admin-bar-cell__track"><div className={`admin-bar-cell__fill ${usageTone(account.usage.dailyCreditsUsed, account.limits.daily)}`} style={{ width: `${Math.min(100, dailyPercent)}%` }}/></div>
                          <span className="admin-bar-cell__pct">{dailyPercent.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td>
                        <div className="admin-bar-cell" title={`${formatCredits(account.usage.monthlyCreditsUsed)} of ${formatCredits(account.limits.monthly)}`}>
                          <div className="admin-bar-cell__track"><div className="admin-bar-cell__fill" style={{ width: `${Math.min(100, monthlyPercent)}%` }}/></div>
                          <span className="admin-bar-cell__pct">{monthlyPercent.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td onClick={event => event.stopPropagation()}>
                        <div className="admin-cell-actions">
                          {account.status !== 'active'
                            ? <button className="admin-btn admin-btn--sm" title={account.status === 'pending' ? 'Activate account' : 'Restore account'} onClick={() => useAdminStore.getState().setAccountStatus(account.id, 'active', 'Quick action from accounts table')}><CheckCircle2 size={12}/></button>
                            : <button className="admin-btn admin-btn--sm admin-btn--danger" title="Suspend account" onClick={() => useAdminStore.getState().setAccountStatus(account.id, 'suspended', 'Quick action from accounts table')}><Ban size={12}/></button>}
                          <Menu ariaLabel={`Actions for ${account.name}`} trigger={<button className="admin-btn admin-btn--sm" aria-label={`More actions for ${account.name}`}><Rows3 size={12}/></button>} items={[
                            { label: 'Open details', onSelect: () => setOpenAccountId(account.id) },
                            { label: account.aiEnabled ? 'Disable AI access' : 'Enable AI access', icon: <ShieldOff size={13}/>, onSelect: () => useAdminStore.getState().setAccountAiAccess(account.id, !account.aiEnabled, 'Quick action from accounts table') },
                            { label: 'Reset daily usage', onSelect: () => useAdminStore.getState().resetAccountDailyUsage(account.id) },
                            { label: 'Registered', disabled: true, separatorBefore: true },
                            { label: formatDayKeyLong(account.createdAt.slice(0, 10)), disabled: true },
                          ]}/>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination page={page} pageCount={pageCount} onPage={setPage} totalLabel={`${filtered.length} accounts · page ${page}/${pageCount}`}/>
      </div>

      <AccountDrawer accountId={openAccountId} onClose={() => setOpenAccountId(null)}/>
      {selectedAccounts.length > 0 && (
        <CreditAdjustDialog open={bulkDialog !== null} accounts={selectedAccounts} mode={bulkDialog ?? 'grant'} onClose={() => { setBulkDialog(null); setSelected(new Set()) }}/>
      )}
    </div>
  )
}
