import { useEffect, useMemo, useState } from 'react'
import { Calculator, CalendarClock, Download, History, Info, Plus, RefreshCcw, Search } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import { calculateCreditCharge, estimateApiCostInr } from '@/lib/admin/credits'
import { formatCredits, formatInr, formatIstDateTime, istDayKey, istMonthKey, nextIstOccurrence } from '@/lib/admin/format'
import { buildCsv, downloadCsv } from '@/lib/admin/csv'
import { TRANSACTION_TYPE_LABELS } from '@/lib/admin/types'
import type { CreditTransaction, TransactionType } from '@/lib/admin/types'
import { AccountStatusBadge, Badge, ConfirmDialog, EmptyState, Menu, Modal, Pagination, Tabs, useDebouncedValue } from './ui'
import { CreditAdjustDialog } from './credit-adjust-dialog'
import { AccountDrawer } from './account-drawer'

const PAGE_SIZE = 12
type CreditTab = 'balances' | 'ledger' | 'calculator' | 'reset'

function sumBy(rows: CreditTransaction[], predicate: (row: CreditTransaction) => boolean): number {
  return Math.round(rows.filter(predicate).reduce((sum, row) => sum + Math.abs(row.amount), 0) * 100) / 100
}

export function CreditsPage() {
  const accounts = useAdminStore(state => state.accounts)
  const transactions = useAdminStore(state => state.transactions)
  const models = useAdminStore(state => state.models)
  const settings = useAdminStore(state => state.settings)
  const resetHistory = useAdminStore(state => state.resetHistory)
  const previewDailyReset = useAdminStore(state => state.previewDailyReset)
  const applyDailyReset = useAdminStore(state => state.applyDailyReset)

  const [tab, setTab] = useState<CreditTab>('balances')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adjustTarget, setAdjustTarget] = useState<{ ids: string[]; mode: 'grant' | 'deduct' | 'promotional' } | null>(null)
  const [openAccountId, setOpenAccountId] = useState<string | null>(null)

  // Ledger filters
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [ledgerAccount, setLedgerAccount] = useState('all')
  const [ledgerType, setLedgerType] = useState<TransactionType | 'all'>('all')
  const [ledgerPage, setLedgerPage] = useState(1)
  const debouncedLedgerSearch = useDebouncedValue(ledgerSearch)

  // Calculator state
  const [calcInput, setCalcInput] = useState('2000')
  const [calcOutput, setCalcOutput] = useState('800')
  const [calcModel, setCalcModel] = useState('sarvam-m')
  const [calcAccount, setCalcAccount] = useState(accounts[0]?.id ?? '')

  // Reset dialog state
  const [resetPreviewOpen, setResetPreviewOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  useEffect(() => { setLedgerPage(1) }, [ledgerAccount, ledgerType, debouncedLedgerSearch])

  const accountById = useMemo(() => new Map(accounts.map(account => [account.id, account])), [accounts])
  const totals = useMemo(() => {
    const remaining = Math.round(accounts.reduce((sum, account) => sum + account.balances.daily + account.balances.permanent + account.balances.promotional, 0) * 100) / 100
    const consumed = sumBy(transactions, row => row.type === 'usage')
    const issued = sumBy(transactions, row => row.amount > 0)
    const refunded = sumBy(transactions, row => row.type === 'refund')
    const expired = sumBy(transactions, row => row.type === 'expiration')
    const todayKey = istDayKey(new Date())
    const monthKey = istMonthKey(new Date())
    const dailyConsumption = Math.round(transactions
      .filter(row => row.type === 'usage' && istDayKey(row.timestamp) === todayKey)
      .reduce((sum, row) => sum + Math.abs(row.amount), 0) * 100) / 100
    const monthlyConsumption = Math.round(transactions
      .filter(row => row.type === 'usage' && istMonthKey(row.timestamp) === monthKey)
      .reduce((sum, row) => sum + Math.abs(row.amount), 0) * 100) / 100
    return { remaining, consumed, issued, refunded, expired, dailyConsumption, monthlyConsumption }
  }, [accounts, transactions])

  const ledgerRows = useMemo(() => {
    const needle = debouncedLedgerSearch.trim().toLowerCase()
    return transactions.filter(row => {
      if (ledgerAccount !== 'all' && row.accountId !== ledgerAccount) return false
      if (ledgerType !== 'all' && row.type !== ledgerType) return false
      if (needle) {
        const account = accountById.get(row.accountId)
        const haystack = `${row.id} ${row.reason} ${row.admin} ${row.requestId ?? ''} ${account?.name ?? ''} ${account?.email ?? ''}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [transactions, ledgerAccount, ledgerType, debouncedLedgerSearch, accountById])
  const ledgerPageCount = Math.max(1, Math.ceil(ledgerRows.length / PAGE_SIZE))
  const ledgerPageRows = ledgerRows.slice((ledgerPage - 1) * PAGE_SIZE, ledgerPage * PAGE_SIZE)

  const model = models.find(item => item.id === calcModel) ?? models[0]
  const calcInputTokens = Number(calcInput) || 0
  const calcOutputTokens = Number(calcOutput) || 0
  const calcCharge = model ? calculateCreditCharge(calcInputTokens, calcOutputTokens, model, settings.creditRules) : 0
  const calcCost = model ? estimateApiCostInr(calcInputTokens, calcOutputTokens, model, settings.costEstimation.markupPercent) : 0
  const calcAccount_ = accounts.find(account => account.id === calcAccount)
  const calcBalance = calcAccount_ ? calcAccount_.balances.daily + calcAccount_.balances.permanent + calcAccount_.balances.promotional : 0
  const calcPerRequestCap = model ? Math.min(model.maxCreditsPerRequest, calcAccount_?.limits.perRequest ?? 0) : 0
  const calcAllowed = calcCharge <= calcPerRequestCap

  const resetPreview = useMemo(() => previewDailyReset(), [previewDailyReset, accounts])
  const nextReset = nextIstOccurrence(settings.resetPolicies.dailyResetTime)

  const exportLedger = () => {
    const csv = buildCsv(ledgerRows, [
      { header: 'Transaction ID', value: (row: CreditTransaction) => row.id },
      { header: 'Timestamp (IST)', value: row => formatIstDateTime(row.timestamp) },
      { header: 'Account', value: row => accountById.get(row.accountId)?.name ?? row.accountId },
      { header: 'Account ID', value: row => row.accountId },
      { header: 'Type', value: row => row.type },
      { header: 'Bucket', value: row => row.bucket },
      { header: 'Amount', value: row => row.amount },
      { header: 'Balance before', value: row => row.balanceBefore },
      { header: 'Balance after', value: row => row.balanceAfter },
      { header: 'Reason', value: row => row.reason },
      { header: 'Administrator', value: row => row.admin },
      { header: 'Related request', value: row => row.requestId ?? '' },
    ])
    downloadCsv(`wireup-credit-ledger-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Credits & limits</h2>
          <p>Credit balances, the full transaction ledger, a pricing calculator and the daily allowance reset — all simulated in the browser.</p>
        </div>
      </div>

      <div className="admin-grid admin-grid--kpi">
        <div className="admin-stat"><span className="admin-stat__label">Credits issued</span><span className="admin-stat__value">{formatCredits(totals.issued)}</span><span className="admin-stat__foot">all grants + allocations on record</span></div>
        <div className="admin-stat"><span className="admin-stat__label">Credits consumed</span><span className="admin-stat__value">{formatCredits(totals.consumed)}</span><span className="admin-stat__foot">usage charges on record</span></div>
        <div className="admin-stat"><span className="admin-stat__label">Credits remaining</span><span className="admin-stat__value">{formatCredits(totals.remaining)}</span><span className="admin-stat__foot">across all balance buckets</span></div>
        <div className="admin-stat"><span className="admin-stat__label">Credits refunded</span><span className="admin-stat__value">{formatCredits(totals.refunded)}</span><span className="admin-stat__foot">failed / cancelled requests</span></div>
        <div className="admin-stat"><span className="admin-stat__label">Credits expired</span><span className="admin-stat__value">{formatCredits(totals.expired)}</span><span className="admin-stat__foot">promotional expirations</span></div>
        <div className="admin-stat"><span className="admin-stat__label">Consumed today</span><span className="admin-stat__value">{formatCredits(totals.dailyConsumption)}</span><span className="admin-stat__foot">IST day</span></div>
        <div className="admin-stat"><span className="admin-stat__label">Consumed this month</span><span className="admin-stat__value">{formatCredits(totals.monthlyConsumption)}</span><span className="admin-stat__foot">current IST month</span></div>
        <div className="admin-stat"><span className="admin-stat__label">Conversion rule</span><span className="admin-stat__value">{settings.creditRules.creditsPer1kInput} / {settings.creditRules.creditsPer1kOutput}</span><span className="admin-stat__foot">credits per 1K input / output tokens</span></div>
      </div>

      <div className="admin-card">
        <Tabs active={tab} onChange={key => setTab(key as CreditTab)} tabs={[
          { key: 'balances', label: 'Account balances' },
          { key: 'ledger', label: 'Transaction ledger', count: transactions.length },
          { key: 'calculator', label: 'Credit calculator' },
          { key: 'reset', label: 'Daily reset' },
        ]}/>

        {tab === 'balances' && (
          <>
            {selected.size > 0 && (
              <div className="admin-card__body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--a-line)' }}>
                <strong style={{ fontSize: 12.5 }}>{selected.size} selected</strong>
                <button className="admin-btn admin-btn--sm admin-btn--primary" onClick={() => setAdjustTarget({ ids: Array.from(selected), mode: 'grant' })}><Plus size={12}/>Grant credits</button>
                <button className="admin-btn admin-btn--sm" onClick={() => setAdjustTarget({ ids: Array.from(selected), mode: 'promotional' })}>Promo</button>
                <button className="admin-btn admin-btn--sm admin-btn--danger" onClick={() => setAdjustTarget({ ids: Array.from(selected), mode: 'deduct' })}>Deduct</button>
                <button className="admin-btn admin-btn--sm admin-btn--ghost" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            )}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}/>
                    <th>Account</th>
                    <th>Status</th>
                    <th className="num">Daily free</th>
                    <th className="num">Permanent</th>
                    <th className="num">Promotional</th>
                    <th className="num">Total</th>
                    <th className="num">Daily used / limit</th>
                    <th className="num">Monthly used / limit</th>
                    <th className="num">Max / request</th>
                    <th/>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(account => (
                    <tr key={account.id} aria-selected={selected.has(account.id)} style={{ cursor: 'pointer' }} onClick={() => setOpenAccountId(account.id)}>
                      <td><input type="checkbox" aria-label={`Select ${account.name}`} checked={selected.has(account.id)} onClick={event => event.stopPropagation()} onChange={() => setSelected(previous => { const next = new Set(previous); if (next.has(account.id)) next.delete(account.id); else next.add(account.id); return next })} style={{ accentColor: 'var(--a-accent)' }}/></td>
                      <td><span className="admin-table__primary">{account.name}</span><div className="admin-table__sub">{account.email}</div></td>
                      <td><AccountStatusBadge status={account.status}/></td>
                      <td className="num">{formatCredits(account.balances.daily)}</td>
                      <td className="num">{formatCredits(account.balances.permanent)}</td>
                      <td className="num">{formatCredits(account.balances.promotional)}{account.promoExpiresAt ? <div className="admin-table__sub">expires {formatIstDateTime(account.promoExpiresAt).slice(0, 8)}</div> : null}</td>
                      <td className="num admin-table__primary">{formatCredits(account.balances.daily + account.balances.permanent + account.balances.promotional)}</td>
                      <td className="num">{formatCredits(account.usage.dailyCreditsUsed)} / {formatCredits(account.limits.daily)}</td>
                      <td className="num">{formatCredits(account.usage.monthlyCreditsUsed)} / {formatCredits(account.limits.monthly)}</td>
                      <td className="num">{formatCredits(account.limits.perRequest)}</td>
                      <td onClick={event => event.stopPropagation()}>
                        <Menu ariaLabel={`Credit actions for ${account.name}`} trigger={<button className="admin-btn admin-btn--sm" aria-label={`Credit actions for ${account.name}`}><History size={12}/></button>} items={[
                          { label: 'Grant permanent credits', onSelect: () => setAdjustTarget({ ids: [account.id], mode: 'grant' }) },
                          { label: 'Grant promotional credits', onSelect: () => setAdjustTarget({ ids: [account.id], mode: 'promotional' }) },
                          { label: 'Deduct credits', onSelect: () => setAdjustTarget({ ids: [account.id], mode: 'deduct' }) },
                          { label: 'Open account details', separatorBefore: true, onSelect: () => setOpenAccountId(account.id) },
                        ]}/>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-pagination"><span className="admin-pagination__info">Balances update everywhere instantly — Accounts, this page, drawers and KPIs share one store.</span></div>
          </>
        )}

        {tab === 'ledger' && (
          <>
            <div className="admin-filters">
              <label className="admin-field" style={{ minWidth: 200 }}>
                <span className="admin-field__label">Search</span>
                <input className="admin-input" placeholder="ID, reason, admin, request…" value={ledgerSearch} onChange={event => setLedgerSearch(event.target.value)}/>
              </label>
              <label className="admin-field">
                <span className="admin-field__label">Account</span>
                <select className="admin-select" value={ledgerAccount} onChange={event => setLedgerAccount(event.target.value)}>
                  <option value="all">All accounts</option>
                  {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
              <label className="admin-field">
                <span className="admin-field__label">Type</span>
                <select className="admin-select" value={ledgerType} onChange={event => setLedgerType(event.target.value as TransactionType | 'all')}>
                  <option value="all">All types</option>
                  {(Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[]).map(type => <option key={type} value={type}>{TRANSACTION_TYPE_LABELS[type]}</option>)}
                </select>
              </label>
              <div className="admin-filters__spacer"/>
              <button className="admin-btn" onClick={exportLedger}><Download size={13}/>Export CSV</button>
            </div>
            <div className="admin-table-wrap">
              {ledgerPageRows.length === 0 ? <EmptyState icon={<Search size={26}/>} title="No transactions match"/> : (
                <table className="admin-table admin-table--compact">
                  <thead>
                    <tr>
                      <th>Transaction ID</th><th>Timestamp</th><th>Account</th><th>Type</th><th className="num">Amount</th>
                      <th className="num">Before</th><th className="num">After</th><th>Reason</th><th>Admin</th><th>Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerPageRows.map(row => {
                      const account = accountById.get(row.accountId)
                      return (
                        <tr key={row.id}>
                          <td className="mono">{row.id}</td>
                          <td className="mono">{formatIstDateTime(row.timestamp)}</td>
                          <td><span className="admin-table__primary">{account?.name ?? row.accountId}</span></td>
                          <td><Badge tone="admin-badge--gray">{TRANSACTION_TYPE_LABELS[row.type]}</Badge></td>
                          <td className="num" style={{ color: row.amount >= 0 ? 'var(--a-green)' : 'var(--a-red)' }}>{row.amount >= 0 ? '+' : ''}{formatCredits(row.amount)}</td>
                          <td className="num">{formatCredits(row.balanceBefore)}</td>
                          <td className="num">{formatCredits(row.balanceAfter)}</td>
                          <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.reason}>{row.reason}</td>
                          <td className="admin-table__sub">{row.admin}</td>
                          <td className="mono">{row.requestId ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <Pagination page={ledgerPage} pageCount={ledgerPageCount} onPage={setLedgerPage} totalLabel={`${ledgerRows.length} transactions · page ${ledgerPage}/${ledgerPageCount}`}/>
            <div className="admin-card__body admin-note" style={{ margin: '0 16px 14px' }}>
              <Info size={13}/>
              <span>The ledger is append-only in this prototype: admin actions add new entries and never overwrite or erase history. In production, immutability must be enforced server-side (Firestore security rules + append-only writes).</span>
            </div>
          </>
        )}

        {tab === 'calculator' && (
          <div className="admin-card__body" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 className="admin-section-title">Simulated request</h3>
              <div className="admin-inline-fields">
                <label className="admin-field"><span className="admin-field__label">Input tokens</span>
                  <input className="admin-input" type="number" min={0} value={calcInput} onChange={event => setCalcInput(event.target.value)}/></label>
                <label className="admin-field"><span className="admin-field__label">Output tokens</span>
                  <input className="admin-input" type="number" min={0} value={calcOutput} onChange={event => setCalcOutput(event.target.value)}/></label>
              </div>
              <label className="admin-field"><span className="admin-field__label">Model</span>
                <select className="admin-select" value={calcModel} onChange={event => setCalcModel(event.target.value)}>
                  {models.map(item => <option key={item.id} value={item.id}>{item.displayName} {item.enabled ? '' : '(disabled)'}</option>)}
                </select></label>
              <label className="admin-field"><span className="admin-field__label">Charge to account</span>
                <select className="admin-select" value={calcAccount} onChange={event => setCalcAccount(event.target.value)}>
                  {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select></label>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 className="admin-section-title">Result</h3>
              <div className="admin-stat" style={{ border: 0, padding: 0 }}>
                <span className="admin-stat__label"><Calculator size={13}/>Simulated credit charge</span>
                <span className="admin-stat__value">{formatCredits(calcCharge)}</span>
                <span className="admin-stat__foot">{settings.creditRules.creditsPer1kInput}/1K in + {settings.creditRules.creditsPer1kOutput}/1K out × {model?.creditMultiplier ?? 1} multiplier</span>
              </div>
              <div className="admin-stat" style={{ border: 0, padding: 0 }}>
                <span className="admin-stat__label">Estimated API cost</span>
                <span className="admin-stat__value">{formatInr(calcCost)}</span>
                <span className="admin-stat__foot">mock pricing: ₹{model?.inputPricePerMillion ?? 0} / ₹{model?.outputPricePerMillion ?? 0} per 1M tokens</span>
              </div>
              <div className="admin-stat" style={{ border: 0, padding: 0 }}>
                <span className="admin-stat__label">Account balance after charge</span>
                <span className="admin-stat__value" style={{ color: calcBalance - calcCharge >= 0 ? 'var(--a-green)' : 'var(--a-red)' }}>{formatCredits(calcBalance - calcCharge)}</span>
                <span className="admin-stat__foot">balance now: {formatCredits(calcBalance)}</span>
              </div>
              {!calcAllowed && <div className="admin-note" style={{ color: '#f0a2a2' }}><Info size={13}/>This charge exceeds the per-request cap ({formatCredits(calcPerRequestCap)} credits = min of model limit {formatCredits(model?.maxCreditsPerRequest ?? 0)} and account limit {formatCredits(calcAccount_?.limits.perRequest ?? 0)}). The mock request would be rejected.</div>}
              <p style={{ margin: 0, fontSize: 11, color: 'var(--a-faint)' }}>
                All pricing here is simulated demo configuration, not real Sarvam AI pricing. Verify every model ID and price with the provider before any production use — real charging must run server-side.
              </p>
            </div>
          </div>
        )}

        {tab === 'reset' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="admin-card__body" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', borderBottom: '1px solid var(--a-line)' }}>
              <div className="admin-stat" style={{ border: 0, padding: 0 }}>
                <span className="admin-stat__label"><CalendarClock size={13}/>Daily reset time</span>
                <span className="admin-stat__value">{settings.resetPolicies.dailyResetTime} IST</span>
                <span className="admin-stat__foot">{settings.resetPolicies.dailyCreditsExpire ? 'unused daily credits expire' : 'daily credits carry over'}</span>
              </div>
              <div className="admin-stat" style={{ border: 0, padding: 0 }}>
                <span className="admin-stat__label">Monthly reset</span>
                <span className="admin-stat__value">Day {settings.resetPolicies.monthlyResetDay}</span>
                <span className="admin-stat__foot">permanent credits {settings.resetPolicies.permanentCarryOver ? 'carry over' : 'do not carry over'}</span>
              </div>
              <div className="admin-stat" style={{ border: 0, padding: 0 }}>
                <span className="admin-stat__label">Next scheduled reset</span>
                <span className="admin-stat__value">{formatIstDateTime(nextReset.toISOString())}</span>
                <span className="admin-stat__foot">simulated until a scheduler is integrated</span>
              </div>
              <div className="admin-stat" style={{ border: 0, padding: 0 }}>
                <span className="admin-stat__label">Last reset</span>
                <span className="admin-stat__value">{resetHistory[0] ? formatIstDateTime(resetHistory[0].triggeredAt) : '—'}</span>
                <span className="admin-stat__foot">{resetHistory[0] ? `${resetHistory[0].accountsAffected} accounts · ${formatCredits(resetHistory[0].creditsReissued)} credits` : 'no history'}</span>
              </div>
            </div>
            <div className="admin-card__body" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--a-line)' }}>
              <button className="admin-btn" onClick={() => setResetPreviewOpen(true)}>Reset preview</button>
              <button className="admin-btn admin-btn--primary" onClick={() => setResetConfirmOpen(true)}><RefreshCcw size={13}/>Confirm reset for {resetPreview.periodId}</button>
              <span className="admin-card__hint">Preview: {resetPreview.eligibleAccounts.length} accounts · {formatCredits(resetPreview.creditsReissued)} credits reissued. Confirming performs the mock reset — idempotent per period ID.</span>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Triggered at</th><th>Period ID (IST day)</th><th className="num">Accounts</th><th className="num">Credits reissued</th><th>Triggered by</th></tr></thead>
                <tbody>
                  {resetHistory.map(entry => (
                    <tr key={entry.id}>
                      <td className="mono">{formatIstDateTime(entry.triggeredAt)}</td>
                      <td className="mono">{entry.periodId}</td>
                      <td className="num">{entry.accountsAffected}</td>
                      <td className="num">{formatCredits(entry.creditsReissued)}</td>
                      <td>{entry.triggeredBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-card__body admin-note">
              <Info size={13}/>
              <span>Resets only zero the <strong>daily allowance counters and balances</strong>. Historical request records, token totals and ledger entries are preserved. Scheduled resets require a backend scheduler (e.g. Cloud Function) — nothing runs automatically in this prototype.</span>
            </div>
          </div>
        )}
      </div>

      <CreditAdjustDialog open={adjustTarget !== null} mode={adjustTarget?.mode ?? 'grant'}
        accounts={accounts.filter(account => adjustTarget?.ids.includes(account.id))}
        onClose={() => { setAdjustTarget(null); setSelected(new Set()) }}/>
      <AccountDrawer accountId={openAccountId} onClose={() => setOpenAccountId(null)}/>

      <Modal open={resetPreviewOpen} title="Daily reset preview" onClose={() => setResetPreviewOpen(false)} wide footer={
        <button className="admin-btn" onClick={() => setResetPreviewOpen(false)}>Close</button>
      }>
        <p>Period <span className="mono">{resetPreview.periodId}</span> · next reset {formatIstDateTime(resetPreview.nextResetAt)} (IST). {resetPreview.eligibleAccounts.length} of {accounts.length} accounts will be reissued their daily allowance.</p>
        {resetPreview.eligibleAccounts.length === 0 ? <EmptyState title="Nothing to reset" body="Every eligible account is already on the current period — the reset is idempotent."/> : (
          <div className="admin-table-wrap" style={{ maxHeight: 320 }}>
            <table className="admin-table admin-table--compact">
              <thead><tr><th>Account</th><th>Status</th><th className="num">Daily used now</th><th className="num">Allowance</th><th className="num">Balance after</th></tr></thead>
              <tbody>
                {resetPreview.eligibleAccounts.map(account => (
                  <tr key={account.id}>
                    <td>{account.name}</td>
                    <td><AccountStatusBadge status={account.status}/></td>
                    <td className="num">{formatCredits(account.usage.dailyCreditsUsed)}</td>
                    <td className="num">{formatCredits(account.limits.daily)}</td>
                    <td className="num">{formatCredits(account.limits.daily + account.balances.permanent + account.balances.promotional)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={resetConfirmOpen} title="Confirm daily reset" tone="danger"
        body={<>Reissue the daily allowance for <strong>{resetPreview.eligibleAccounts.length} accounts</strong> ({formatCredits(resetPreview.creditsReissued)} credits) and zero their daily usage counters for period <span className="mono">{resetPreview.periodId}</span>. Historical usage and the ledger are preserved. This is a simulated reset — no scheduler is connected.</>}
        confirmLabel={`Reset ${resetPreview.eligibleAccounts.length} accounts`} typedConfirmation="RESET"
        onClose={() => setResetConfirmOpen(false)} onConfirm={() => applyDailyReset('Manual reset from Credits & Limits')}/>
    </div>
  )
}
