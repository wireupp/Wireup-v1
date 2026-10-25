import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, Save, Trash2 } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import { accountsApproachingLimit } from '@/lib/admin/selectors'
import { formatCredits, formatNumber } from '@/lib/admin/format'
import type { AccountRole, RateLimitConfig, RateLimitRoleRule } from '@/lib/admin/types'
import { AccountStatusBadge, Badge, ConfirmDialog } from './ui'

const ROLE_LABELS: Record<AccountRole, string> = { user: 'User', pro: 'Pro', team: 'Team', admin: 'Administrator' }

function NumberField({ label, value, onChange, min = 0, hint }: { label: string; value: number; onChange: (value: number) => void; min?: number; hint?: string }) {
  const [text, setText] = useState(String(value))
  const [touched, setTouched] = useState(false)
  const parsed = Number(text)
  const invalid = touched && (!Number.isFinite(parsed) || parsed < min)
  return (
    <label className="admin-field">
      <span className="admin-field__label">{label}</span>
      <input className="admin-input" type="number" min={min} value={text}
        onChange={event => { setText(event.target.value); setTouched(true); const next = Number(event.target.value); if (Number.isFinite(next) && next >= min) onChange(next) }}/>
      {invalid ? <span className="admin-field__error">Must be a number ≥ {min}</span> : hint ? <span className="admin-field__hint">{hint}</span> : null}
    </label>
  )
}

export function RateLimitsPage() {
  const rateLimits = useAdminStore(state => state.rateLimits)
  const accounts = useAdminStore(state => state.accounts)
  const models = useAdminStore(state => state.models)
  const updateRateLimits = useAdminStore(state => state.updateRateLimits)

  // The editor works on a draft; Save commits it to the store, Cancel discards.
  const [draft, setDraft] = useState<RateLimitConfig>(rateLimits)
  const [dirty, setDirty] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [newOverrideId, setNewOverrideId] = useState('')

  const mutate = (mutator: (draft: RateLimitConfig) => void) => {
    setDraft(previous => {
      const next = structuredClone(previous)
      mutator(next)
      return next
    })
    setDirty(true)
  }

  const reset = () => { setDraft(structuredClone(rateLimits)); setDirty(false) }
  const save = () => setConfirmOpen(true)

  const approaching = useMemo(() => accountsApproachingLimit(accounts, 70).sort((a, b) => (b.usage.dailyCreditsUsed / b.limits.daily) - (a.usage.dailyCreditsUsed / a.limits.daily)), [accounts])

  // Simulated policy preview: accounts whose current daily usage would exceed the new limits.
  const previewRows = useMemo(() => accounts.map(account => {
    const override = draft.accountOverrides[account.id]
    const effectiveDaily = Math.min(draft.requestsPerDay, draft.roleRules[account.role].requestsPerDay, override?.requestsPerDay ?? Infinity)
    const effectiveCredits = Math.min(draft.requestsPerDay * 3, override?.dailyCredits ?? account.limits.daily)
    const requestBreach = account.usage.requestsToday > effectiveDaily
    const creditBreach = account.usage.dailyCreditsUsed > effectiveCredits
    return { account, effectiveDaily, effectiveCredits, requestBreach, creditBreach }
  }).filter(row => row.requestBreach || row.creditBreach), [accounts, draft])

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Rate limits & access policies</h2>
          <p>Throttle defaults, model rules, role quotas and per-account overrides. Saved to frontend state only.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn" onClick={reset} disabled={!dirty}>Cancel</button>
          <button className="admin-btn admin-btn--primary" onClick={save} disabled={!dirty}><Save size={13}/>Save policies</button>
        </div>
      </div>

      <div className="admin-note" style={{ maxWidth: 760 }}>
        <AlertTriangle size={14}/>
        <span><strong>No real enforcement:</strong> these settings are stored in the browser for the prototype. Server-side rate limiting (e.g. Cloud Functions + Firestore counters) must be implemented before any of this affects live traffic.</span>
      </div>

      {dirty && <div className="admin-note admin-note--info" style={{ maxWidth: 760 }}><AlertTriangle size={14}/><span>Unsaved changes — use <strong>Save policies</strong> to apply them to the mock configuration, or <strong>Cancel</strong> to discard.</span></div>}

      <div className="admin-settings-section">
        <div className="admin-card__header"><span className="admin-card__title">Per-account throttles</span></div>
        <div className="admin-settings-grid">
          <NumberField label="Requests per minute" value={draft.requestsPerMinute} onChange={value => mutate(draft => { draft.requestsPerMinute = value })}/>
          <NumberField label="Requests per hour" value={draft.requestsPerHour} onChange={value => mutate(draft => { draft.requestsPerHour = value })}/>
          <NumberField label="Requests per day" value={draft.requestsPerDay} onChange={value => mutate(draft => { draft.requestsPerDay = value })}/>
          <NumberField label="Max concurrent requests" value={draft.maxConcurrentRequests} onChange={value => mutate(draft => { draft.maxConcurrentRequests = value })}/>
        </div>
      </div>

      <div className="admin-settings-section">
        <div className="admin-card__header"><span className="admin-card__title">Request size caps</span></div>
        <div className="admin-settings-grid">
          <NumberField label="Max input tokens / request" value={draft.maxInputTokensPerRequest} onChange={value => mutate(draft => { draft.maxInputTokensPerRequest = value })}/>
          <NumberField label="Max output tokens / request" value={draft.maxOutputTokensPerRequest} onChange={value => mutate(draft => { draft.maxOutputTokensPerRequest = value })}/>
          <NumberField label="Max credits / request" value={draft.maxCreditsPerRequest} onChange={value => mutate(draft => { draft.maxCreditsPerRequest = value })}/>
        </div>
      </div>

      <div className="admin-settings-section">
        <div className="admin-card__header"><span className="admin-card__title">Global platform limits</span></div>
        <div className="admin-settings-grid">
          <NumberField label="Global requests / minute" value={draft.globalRequestsPerMinute} onChange={value => mutate(draft => { draft.globalRequestsPerMinute = value })}/>
          <NumberField label="Global requests / day" value={draft.globalRequestsPerDay} onChange={value => mutate(draft => { draft.globalRequestsPerDay = value })}/>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__header"><span className="admin-card__title">Model-specific limits</span><span className="admin-card__hint">daily request ceilings per model</span></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Model</th><th>Status</th><th>Requests / day</th><th>Max output tokens</th></tr></thead>
            <tbody>
              {models.map(model => (
                <tr key={model.id}>
                  <td><span className="admin-table__primary">{model.displayName}</span><div className="admin-table__sub mono">{model.id}</div></td>
                  <td><Badge tone={model.enabled ? 'admin-badge--green' : 'admin-badge--gray'}>{model.enabled ? 'Enabled' : 'Disabled'}</Badge></td>
                  <td>
                    <input className="admin-input" style={{ width: 110 }} type="number" min={0} aria-label={`Requests per day for ${model.displayName}`}
                      value={draft.modelRules[model.id]?.requestsPerDay ?? 0}
                      onChange={event => mutate(next => { next.modelRules[model.id] = { requestsPerDay: Math.max(0, Number(event.target.value) || 0), maxOutputTokens: next.modelRules[model.id]?.maxOutputTokens ?? model.maxOutputTokens } })}/>
                  </td>
                  <td>
                    <input className="admin-input" style={{ width: 110 }} type="number" min={1} aria-label={`Max output tokens for ${model.displayName}`}
                      value={draft.modelRules[model.id]?.maxOutputTokens ?? model.maxOutputTokens}
                      onChange={event => mutate(next => { next.modelRules[model.id] = { requestsPerDay: next.modelRules[model.id]?.requestsPerDay ?? 4000, maxOutputTokens: Math.max(1, Number(event.target.value) || 1) } })}/>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__header"><span className="admin-card__title">Role-based limits</span></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Role</th><th>Requests / day</th><th>Daily credits</th></tr></thead>
            <tbody>
              {(Object.keys(ROLE_LABELS) as AccountRole[]).map(role => (
                <tr key={role}>
                  <td><span className="admin-table__primary">{ROLE_LABELS[role]}</span></td>
                  <td>
                    <input className="admin-input" style={{ width: 110 }} type="number" min={0} aria-label={`Requests per day for ${role}`}
                      value={draft.roleRules[role].requestsPerDay}
                      onChange={event => mutate(next => { next.roleRules[role] = { ...next.roleRules[role], requestsPerDay: Math.max(0, Number(event.target.value) || 0) } as RateLimitRoleRule })}/>
                  </td>
                  <td>
                    <input className="admin-input" style={{ width: 110 }} type="number" min={0} aria-label={`Daily credits for ${role}`}
                      value={draft.roleRules[role].dailyCredits}
                      onChange={event => mutate(next => { next.roleRules[role] = { ...next.roleRules[role], dailyCredits: Math.max(0, Number(event.target.value) || 0) } as RateLimitRoleRule })}/>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">Account-specific overrides</span>
          <span className="admin-card__hint">win over role and platform defaults</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Account</th><th>Requests / day</th><th>Daily credits</th><th>Note</th><th/></tr></thead>
            <tbody>
              {Object.entries(draft.accountOverrides).map(([accountId, override]) => {
                const account = accounts.find(item => item.id === accountId)
                return (
                  <tr key={accountId}>
                    <td><span className="admin-table__primary">{account?.name ?? accountId}</span><div className="admin-table__sub mono">{accountId}</div></td>
                    <td><input className="admin-input" style={{ width: 110 }} type="number" min={0} aria-label={`Override requests per day for ${account?.name ?? accountId}`} value={override.requestsPerDay ?? ''} placeholder="—" onChange={event => mutate(next => { const value = Number(event.target.value); next.accountOverrides[accountId] = { ...next.accountOverrides[accountId], requestsPerDay: Number.isFinite(value) && event.target.value !== '' ? value : undefined } })}/></td>
                    <td><input className="admin-input" style={{ width: 110 }} type="number" min={0} aria-label={`Override daily credits for ${account?.name ?? accountId}`} value={override.dailyCredits ?? ''} placeholder="—" onChange={event => mutate(next => { const value = Number(event.target.value); next.accountOverrides[accountId] = { ...next.accountOverrides[accountId], dailyCredits: Number.isFinite(value) && event.target.value !== '' ? value : undefined } })}/></td>
                    <td><input className="admin-input" style={{ width: 220 }} value={override.note ?? ''} placeholder="Reason for override" aria-label={`Override note for ${account?.name ?? accountId}`} onChange={event => mutate(next => { next.accountOverrides[accountId] = { ...next.accountOverrides[accountId], note: event.target.value } })}/></td>
                    <td><button className="admin-btn admin-btn--sm admin-btn--danger" aria-label={`Remove override for ${account?.name ?? accountId}`} onClick={() => mutate(next => { delete next.accountOverrides[accountId] })}><Trash2 size={12}/></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="admin-card__body" style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--a-line)', flexWrap: 'wrap' }}>
          <select className="admin-select" style={{ maxWidth: 260 }} value={newOverrideId} onChange={event => setNewOverrideId(event.target.value)} aria-label="Choose account to override">
            <option value="">Add override for account…</option>
            {accounts.filter(account => !draft.accountOverrides[account.id]).map(account => (
              <option key={account.id} value={account.id}>{account.name} ({account.email})</option>
            ))}
          </select>
          <button className="admin-btn" disabled={!newOverrideId} onClick={() => { mutate(next => { next.accountOverrides[newOverrideId] = {} }); setNewOverrideId('') }}><Plus size={13}/>Add</button>
        </div>
      </div>

      <div className="admin-grid admin-grid--half">
        <div className="admin-card">
          <div className="admin-card__header">
            <span className="admin-card__title">Policy preview (simulated)</span>
            <span className="admin-card__hint">accounts that would breach these limits today</span>
          </div>
          <div className="admin-table-wrap">
            {previewRows.length === 0 ? (
              <div className="admin-empty"><strong>No accounts would breach the drafted limits today</strong><p>Based on current daily usage versus the drafted per-account, role and override limits.</p></div>
            ) : (
              <table className="admin-table">
                <thead><tr><th>Account</th><th>Effective daily requests</th><th>Effective daily credits</th><th>Breach</th></tr></thead>
                <tbody>
                  {previewRows.map(row => (
                    <tr key={row.account.id}>
                      <td><span className="admin-table__primary">{row.account.name}</span></td>
                      <td className="num">{formatNumber(row.effectiveDaily)}</td>
                      <td className="num">{formatCredits(row.effectiveCredits)}</td>
                      <td>{row.requestBreach ? <Badge tone="admin-badge--red">requests</Badge> : null} {row.creditBreach ? <Badge tone="admin-badge--amber">credits</Badge> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card__header"><span className="admin-card__title">Accounts approaching limits</span><span className="admin-card__hint">≥70% of daily allowance used</span></div>
          <div className="admin-table-wrap">
            {approaching.length === 0 ? (
              <div className="admin-empty"><strong>None right now</strong><p>No active account is above 70% of its daily allowance.</p></div>
            ) : (
              <table className="admin-table">
                <thead><tr><th>Account</th><th>Status</th><th className="num">Used / limit</th><th className="num">Utilisation</th></tr></thead>
                <tbody>
                  {approaching.map(account => {
                    const percent = account.limits.daily > 0 ? (account.usage.dailyCreditsUsed / account.limits.daily) * 100 : 0
                    return (
                      <tr key={account.id}>
                        <td><span className="admin-table__primary">{account.name}</span><div className="admin-table__sub">{account.email}</div></td>
                        <td><AccountStatusBadge status={account.status}/></td>
                        <td className="num">{formatCredits(account.usage.dailyCreditsUsed)} / {formatCredits(account.limits.daily)}</td>
                        <td className="num" style={{ color: percent >= 90 ? 'var(--a-red)' : 'var(--a-amber)' }}>{percent.toFixed(0)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog open={confirmOpen} title="Save rate limit policies"
        body={<>Apply the drafted policies to the mock configuration? They take effect in the simulated policy preview immediately, but <strong>no server-side enforcement exists</strong> in this prototype.</>}
        confirmLabel="Save policies" onClose={() => setConfirmOpen(false)}
        onConfirm={() => { updateRateLimits(draft, 'Updated in Rate Limits & Access Policies'); setDirty(false) }}/>
    </div>
  )
}
