import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts'
import { Ban, CheckCircle2, Coins, Pencil, RefreshCcw, ShieldOff } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import {
  formatCredits, formatDayKeyShort, formatInr, formatIstDate, formatIstDateTime, formatNumber, istDayKey, relativeTime,
} from '@/lib/admin/format'
import { REQUEST_TYPE_LABELS } from '@/lib/admin/types'
import type { AccountRole, AccountStatus } from '@/lib/admin/types'
import { AccountStatusBadge, Badge, ConfirmDialog, Drawer, DrawerSection, KeyValue, Modal, RequestStatusBadge } from './ui'
import { CreditAdjustDialog } from './credit-adjust-dialog'
import { RequestDrawer } from './request-drawer'
import { useAdminTheme } from './admin-app'

type DialogKind = 'status' | 'role' | 'limits' | 'grant' | 'deduct' | 'promo' | 'reset' | null

const ROLE_LABELS: Record<AccountRole, string> = { user: 'User', pro: 'Pro', team: 'Team', admin: 'Administrator' }

function ReasonForm({ value, onChange, label = 'Reason (recorded in the audit log)' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <label className="admin-field">
      <span className="admin-field__label">{label}</span>
      <textarea className="admin-textarea" value={value} onChange={event => onChange(event.target.value)} placeholder="Optional context for this action"/>
    </label>
  )
}

/** Full account profile with every management action from the spec. */
export function AccountDrawer({ accountId, onClose }: { accountId: string | null; onClose: () => void }) {
  const accounts = useAdminStore(state => state.accounts)
  const requests = useAdminStore(state => state.requests)
  const transactions = useAdminStore(state => state.transactions)
  const models = useAdminStore(state => state.models)
  const setAccountStatus = useAdminStore(state => state.setAccountStatus)
  const setAccountRole = useAdminStore(state => state.setAccountRole)
  const setAccountAiAccess = useAdminStore(state => state.setAccountAiAccess)
  const updateAccountLimits = useAdminStore(state => state.updateAccountLimits)
  const resetAccountDailyUsage = useAdminStore(state => state.resetAccountDailyUsage)

  const [dialog, setDialog] = useState<DialogKind>(null)
  const [statusTarget, setStatusTarget] = useState<AccountStatus>('active')
  const [roleTarget, setRoleTarget] = useState<AccountRole>('user')
  const [reason, setReason] = useState('')
  const [limitDraft, setLimitDraft] = useState({ daily: '0', monthly: '0', perRequest: '0' })
  const [requestDrawerId, setRequestDrawerId] = useState<string | null>(null)
  const { themeDef } = useAdminTheme()
  const gridColor = themeDef.chart.grid
  const tickFill = themeDef.chart.tick

  const account = accounts.find(item => item.id === accountId) ?? null
  const accountRequests = useMemo(() => account ? requests.filter(request => request.accountId === account.id) : [], [requests, account])
  const accountTransactions = useMemo(() => account ? transactions.filter(item => item.accountId === account.id).slice(0, 6) : [], [transactions, account])
  const usageChart = useMemo(() => {
    if (!account) return []
    const byDay = new Map<string, number>()
    for (const request of accountRequests) {
      const day = istDayKey(request.timestamp)
      byDay.set(day, (byDay.get(day) ?? 0) + request.creditsCharged)
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([label, credits]) => ({ label, credits }))
  }, [accountRequests, account])
  const topModel = useMemo(() => {
    const counts = new Map<string, number>()
    for (const request of accountRequests) counts.set(request.modelId, (counts.get(request.modelId) ?? 0) + 1)
    const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]
    return best ? models.find(model => model.id === best[0])?.displayName ?? best[0] : '—'
  }, [accountRequests, models])
  const lifetimeCost = useMemo(() => Math.round(accountRequests.reduce((sum, request) => sum + request.estimatedCostInr, 0) * 100) / 100, [accountRequests])

  if (!account) return null
  const totalBalance = account.balances.daily + account.balances.permanent + account.balances.promotional
  const dailyPercent = account.limits.daily > 0 ? Math.min(100, (account.usage.dailyCreditsUsed / account.limits.daily) * 100) : 0
  const monthlyPercent = account.limits.monthly > 0 ? Math.min(100, (account.usage.monthlyCreditsUsed / account.limits.monthly) * 100) : 0
  const recentRequests = accountRequests.slice(0, 5)
  const selectedRequest = requestDrawerId ? requests.find(request => request.id === requestDrawerId) ?? null : null

  const openDialog = (kind: DialogKind) => { setReason(''); setDialog(kind) }
  const openStatus = (target: AccountStatus) => { setStatusTarget(target); openDialog('status') }

  const barFill = dailyPercent >= 90 ? 'admin-bar-cell__fill--crit' : dailyPercent >= 70 ? 'admin-bar-cell__fill--warn' : ''

  return (
    <>
      <Drawer open title={account.name} sub={`${account.email} · ${account.id}`} onClose={onClose} footer={
        <>
          {account.status !== 'active' && <button className="admin-btn" onClick={() => openStatus('active')}><CheckCircle2 size={13}/>{account.status === 'pending' ? 'Activate' : 'Restore'}</button>}
          {account.status !== 'suspended' && <button className="admin-btn admin-btn--danger" onClick={() => openStatus('suspended')}><Ban size={13}/>Suspend</button>}
          {account.status !== 'restricted' && account.status !== 'suspended' && <button className="admin-btn" onClick={() => openStatus('restricted')}><ShieldOff size={13}/>Restrict</button>}
          <button className="admin-btn" onClick={() => setAccountAiAccess(account.id, !account.aiEnabled, 'Toggled from account drawer')}>
            {account.aiEnabled ? <ShieldOff size={13}/> : <CheckCircle2 size={13}/>}{account.aiEnabled ? 'Disable AI access' : 'Enable AI access'}
          </button>
          <button className="admin-btn" onClick={() => openDialog('role')}><Pencil size={13}/>Change role</button>
          <button className="admin-btn" onClick={() => { setLimitDraft({ daily: String(account.limits.daily), monthly: String(account.limits.monthly), perRequest: String(account.limits.perRequest) }); openDialog('limits') }}><Pencil size={13}/>Edit limits</button>
          <button className="admin-btn admin-btn--primary" onClick={() => openDialog('grant')}><Coins size={13}/>Grant credits</button>
          <button className="admin-btn" onClick={() => openDialog('deduct')}>Deduct</button>
          <button className="admin-btn" onClick={() => openDialog('promo')}>Promo</button>
          <button className="admin-btn" onClick={() => openDialog('reset')}><RefreshCcw size={13}/>Reset daily usage</button>
        </>
      }>
        <DrawerSection title="Profile">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <AccountStatusBadge status={account.status}/>
            <Badge tone="admin-badge--blue">{ROLE_LABELS[account.role]}</Badge>
            <Badge tone={account.aiEnabled ? 'admin-badge--green' : 'admin-badge--gray'}>AI access {account.aiEnabled ? 'enabled' : 'disabled'}</Badge>
            <Badge tone="admin-badge--gray">{account.organization}</Badge>
          </div>
          <KeyValue rows={[
            ['User ID', <span className="mono">{account.id}</span>],
            ['Created', formatIstDate(account.createdAt)],
            ['Last active', `${relativeTime(account.lastActiveAt)} · ${formatIstDateTime(account.lastActiveAt)}`],
            ['Daily period', <span className="mono">{account.dailyPeriodId || '—'}</span>],
          ]}/>
        </DrawerSection>

        <DrawerSection title="Credit balances">
          <KeyValue rows={[
            ['Daily free', `${formatCredits(account.balances.daily)} of ${formatCredits(account.limits.daily)}`],
            ['Permanent', formatCredits(account.balances.permanent)],
            ['Promotional', account.promoExpiresAt ? `${formatCredits(account.balances.promotional)} (expires ${formatIstDate(account.promoExpiresAt)})` : formatCredits(account.balances.promotional)],
            ['Total balance', formatCredits(totalBalance)],
          ]}/>
          <div>
            <div className="admin-bar-cell" style={{ marginBottom: 6 }}>
              <div className="admin-bar-cell__track"><div className={`admin-bar-cell__fill ${barFill}`} style={{ width: `${dailyPercent}%` }}/></div>
              <span className="admin-bar-cell__pct">{dailyPercent.toFixed(0)}% daily</span>
            </div>
            <div className="admin-bar-cell">
              <div className="admin-bar-cell__track"><div className="admin-bar-cell__fill" style={{ width: `${monthlyPercent}%` }}/></div>
              <span className="admin-bar-cell__pct">{monthlyPercent.toFixed(0)}% monthly</span>
            </div>
          </div>
        </DrawerSection>

        <DrawerSection title="Usage & limits">
          <KeyValue rows={[
            ['Requests today', formatNumber(account.usage.requestsToday)],
            ['Daily usage', `${formatCredits(account.usage.dailyCreditsUsed)} / ${formatCredits(account.limits.daily)} credits`],
            ['Monthly usage', `${formatCredits(account.usage.monthlyCreditsUsed)} / ${formatCredits(account.limits.monthly)} credits`],
            ['Per-request cap', `${formatCredits(account.limits.perRequest)} credits`],
            ['Lifetime requests', formatNumber(account.usage.lifetimeRequests)],
            ['Lifetime tokens', `${formatNumber(account.usage.lifetimeInputTokens)} in / ${formatNumber(account.usage.lifetimeOutputTokens)} out`],
            ['Lifetime credits', formatCredits(account.usage.lifetimeCredits)],
            ['Lifetime est. cost', `${formatInr(lifetimeCost)} (simulated)`],
            ['Most used model', topModel],
          ]}/>
        </DrawerSection>

        <DrawerSection title="Credits per day (last 14 active days)">
          {usageChart.length === 0 ? <p style={{ margin: 0, color: 'var(--a-faint)', fontSize: 12 }}>No usage recorded yet.</p> : (
            <div style={{ height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={usageChart} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={gridColor} vertical={false}/>
                  <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 9.5 }} tickLine={false} axisLine={{ stroke: gridColor }} tickFormatter={value => formatDayKeyShort(String(value))} interval="preserveStartEnd" minTickGap={24}/>
                  <YAxis tick={{ fill: tickFill, fontSize: 9.5 }} tickLine={false} axisLine={false} width={40}/>
                  <ReTooltip content={<ChartTip/>}/>
                  <Area type="monotone" dataKey="credits" name="Credits" stroke="#8f7ff0" fill="rgba(143,127,240,.18)" strokeWidth={1.6}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </DrawerSection>

        <DrawerSection title="Recent AI requests">
          {recentRequests.length === 0 ? <p style={{ margin: 0, color: 'var(--a-faint)', fontSize: 12 }}>No requests recorded.</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--compact">
                <thead><tr><th>Time</th><th>Type</th><th className="num">Tokens</th><th className="num">Credits</th><th>Status</th></tr></thead>
                <tbody>
                  {recentRequests.map(request => (
                    <tr key={request.id} style={{ cursor: 'pointer' }} onClick={() => setRequestDrawerId(request.id)}>
                      <td className="mono">{formatIstDateTime(request.timestamp)}</td>
                      <td>{REQUEST_TYPE_LABELS[request.type]}</td>
                      <td className="num">{formatNumber(request.inputTokens + request.outputTokens)}</td>
                      <td className="num">{formatCredits(request.creditsCharged)}</td>
                      <td><RequestStatusBadge status={request.status}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DrawerSection>

        <DrawerSection title="Recent credit transactions">
          {accountTransactions.length === 0 ? <p style={{ margin: 0, color: 'var(--a-faint)', fontSize: 12 }}>No transactions recorded.</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--compact">
                <thead><tr><th>Time</th><th>Type</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  {accountTransactions.map(transaction => (
                    <tr key={transaction.id}>
                      <td className="mono">{formatIstDateTime(transaction.timestamp)}</td>
                      <td>{transaction.type.replaceAll('_', ' ')}</td>
                      <td className="num" style={{ color: transaction.amount >= 0 ? 'var(--a-green)' : 'var(--a-red)' }}>{transaction.amount >= 0 ? '+' : ''}{formatCredits(transaction.amount)}</td>
                      <td className="num">{formatCredits(transaction.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DrawerSection>
      </Drawer>

      <ConfirmDialog open={dialog === 'status'} title={statusTarget === 'suspended' ? 'Suspend account' : statusTarget === 'restricted' ? 'Restrict account' : statusTarget === 'active' && account.status === 'pending' ? 'Activate account' : 'Restore account'}
        body={<>
          <div style={{ color: 'var(--a-text)' }}>Change <strong>{account.name}</strong> status from <Badge>{account.status}</Badge> to <Badge tone={statusTarget === 'active' ? 'admin-badge--green' : statusTarget === 'suspended' ? 'admin-badge--red' : 'admin-badge--amber'}>{statusTarget}</Badge>. {statusTarget !== 'active' ? 'AI access is disabled automatically.' : 'AI access is re-enabled automatically.'}</div>
          <ReasonFormWrapper onReason={setReason}/>
        </>}
        confirmLabel="Apply status" tone={statusTarget === 'suspended' ? 'danger' : 'primary'} typedConfirmation={statusTarget === 'suspended' ? 'SUSPEND' : undefined}
        onClose={() => setDialog(null)} onConfirm={() => setAccountStatus(account.id, statusTarget, reason.trim())}/>

      <Modal open={dialog === 'role'} title="Change role" onClose={() => setDialog(null)} footer={<>
        <button className="admin-btn" onClick={() => setDialog(null)}>Cancel</button>
        <button className="admin-btn admin-btn--primary" onClick={() => { setAccountRole(account.id, roleTarget, reason.trim()); setDialog(null) }}>Save role</button>
      </>}>
        <label className="admin-field">
          <span className="admin-field__label">Role for {account.name}</span>
          <select className="admin-select" value={roleTarget} onChange={event => setRoleTarget(event.target.value as AccountRole)}>
            {(Object.keys(ROLE_LABELS) as AccountRole[]).map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select>
        </label>
        <ReasonForm value={reason} onChange={setReason}/>
      </Modal>

      <Modal open={dialog === 'limits'} title="Edit limits" onClose={() => setDialog(null)} footer={<>
        <button className="admin-btn" onClick={() => setDialog(null)}>Cancel</button>
        <button className="admin-btn admin-btn--primary" onClick={() => {
          updateAccountLimits(account.id, { daily: Number(limitDraft.daily) || account.limits.daily, monthly: Number(limitDraft.monthly) || account.limits.monthly, perRequest: Number(limitDraft.perRequest) || account.limits.perRequest }, reason.trim() || 'Edited from account drawer')
          setDialog(null)
        }}>Save limits</button>
      </>}>
        <div className="admin-inline-fields">
          <label className="admin-field"><span className="admin-field__label">Daily credit limit</span><input className="admin-input" type="number" min={0} value={limitDraft.daily} onChange={event => setLimitDraft({ ...limitDraft, daily: event.target.value })}/></label>
          <label className="admin-field"><span className="admin-field__label">Monthly limit</span><input className="admin-input" type="number" min={0} value={limitDraft.monthly} onChange={event => setLimitDraft({ ...limitDraft, monthly: event.target.value })}/></label>
          <label className="admin-field"><span className="admin-field__label">Max credits / request</span><input className="admin-input" type="number" min={0} value={limitDraft.perRequest} onChange={event => setLimitDraft({ ...limitDraft, perRequest: event.target.value })}/></label>
        </div>
        <ReasonForm value={reason} onChange={setReason}/>
      </Modal>

      <ConfirmDialog open={dialog === 'reset'} title="Reset daily usage"
        body={<>Restore the daily allowance for <strong>{account.name}</strong> and zero the daily usage counter for period <span className="mono">{account.dailyPeriodId || '(new period)'}</span>. Historical request records and the credit ledger are preserved.</>}
        confirmLabel="Reset daily usage" onClose={() => setDialog(null)} onConfirm={() => resetAccountDailyUsage(account.id)}/>

      <CreditAdjustDialog open={dialog === 'grant'} accounts={[account]} mode="grant" onClose={() => setDialog(null)}/>
      <CreditAdjustDialog open={dialog === 'deduct'} accounts={[account]} mode="deduct" onClose={() => setDialog(null)}/>
      <CreditAdjustDialog open={dialog === 'promo'} accounts={[account]} mode="promotional" onClose={() => setDialog(null)}/>
      <RequestDrawer request={selectedRequest} onClose={() => setRequestDrawerId(null)}/>
    </>
  )
}

function ReasonFormWrapper({ onReason }: { onReason: (value: string) => void }) {
  const [value, setValue] = useState('')
  return <ReasonForm value={value} onChange={value => { setValue(value); onReason(value) }}/>
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { value?: number; name?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--a-popover)', border: '1px solid var(--a-line-strong)', borderRadius: 8, padding: '6px 9px', fontSize: 11.5, color: 'var(--a-text)' }}>
      <div style={{ color: 'var(--a-faint)', fontFamily: 'var(--a-mono)', fontSize: 10 }}>{label}</div>
      <div>{payload[0]?.name}: {formatCredits(Number(payload[0]?.value ?? 0))}</div>
    </div>
  )
}
