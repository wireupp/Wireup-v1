import { useEffect, useState, type ReactNode } from 'react'
import { Database, RotateCcw, Save } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import { PERIOD_LABELS } from '@/lib/admin/types'
import type { AccountRole, AdminSettings, PeriodKey } from '@/lib/admin/types'
import { Badge, ConfirmDialog, Switch } from './ui'
import { ADMIN_THEMES, useAdminTheme } from './admin-app'

const DEFAULT_SETTINGS: AdminSettings = {
  platformName: 'WireUp',
  timezone: 'Asia/Kolkata',
  numberFormatLocale: 'en-IN',
  compactNumbers: true,
  defaultPeriod: '7d',
  defaultDailyFreeCredits: 500,
  defaultMonthlyLimit: 15000,
  defaultRole: 'user',
  defaultAiAccess: true,
  defaultModelId: 'sarvam-m',
  defaultMaxOutputTokens: 4096,
  creditRules: { creditsPer1kInput: 2, creditsPer1kOutput: 6 },
  costEstimation: { includeFailedRequests: true, markupPercent: 0 },
  resetPolicies: { dailyResetTime: '00:00', monthlyResetDay: 1, dailyCreditsExpire: true, permanentCarryOver: true, promoValidityDays: 30 },
  notifications: { creditThresholdPercent: 80, failedRequestThreshold: 5, dailyCostThresholdInr: 500, unusualConsumptionPercent: 200 },
}

const KIND_LABELS = { dark: 'Dark', white: 'White', mix: 'Mix' } as const

export function SettingsPage() {
  const settings = useAdminStore(state => state.settings)
  const models = useAdminStore(state => state.models)
  const updateSettings = useAdminStore(state => state.updateSettings)
  const resetDemoData = useAdminStore(state => state.resetDemoData)
  const pushToast = useAdminStore(state => state.pushToast)
  const { theme, setTheme } = useAdminTheme()

  const [draft, setDraft] = useState<AdminSettings>(structuredClone(settings))
  const [confirmReset, setConfirmReset] = useState(false)

  // If settings change elsewhere (another admin action), refresh the draft when not dirty.
  useEffect(() => { setDraft(structuredClone(settings)) }, [settings])

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  const save = () => {
    updateSettings(draft, 'Updated in Admin Settings')
    pushToast({ title: 'Settings saved', tone: 'success', description: 'Persisted to localStorage for this prototype.' })
  }

  // Small self-contained tiles ("cubes"): label, control and hint packed tight.
  const field = (label: string, control: ReactNode, hint?: string) => (
    <div className="admin-cube">
      <span className="admin-cube__label" title={label}>{label}</span>
      {control}
      {hint && <span className="admin-cube__hint">{hint}</span>}
    </div>
  )

  const numberField = (label: string, hint: string, value: number, onChange: (value: number) => void, min = 0, max = 1_000_000) =>
    field(label,
      <input className="admin-input" type="number" min={min} max={max} value={value} onChange={event => onChange(Math.min(max, Math.max(min, Number(event.target.value) || 0)))}/>,
      hint)

  const switchField = (label: string, hint: string, checked: boolean, onChange: (value: boolean) => void) =>
    field(label, <span className="admin-switch-row"><Switch checked={checked} onChange={onChange} label={label}/></span>, hint)

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Admin settings</h2>
          <p>Platform preferences, defaults, reset policies and alerts. Stored in localStorage (demo) — never store real credentials here.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn" onClick={() => setDraft(structuredClone(DEFAULT_SETTINGS))}><RotateCcw size={13}/>Restore defaults</button>
          <button className="admin-btn" onClick={() => setDraft(structuredClone(settings))} disabled={!dirty}>Cancel</button>
          <button className="admin-btn admin-btn--primary" onClick={save} disabled={!dirty}><Save size={13}/>Save settings</button>
        </div>
      </div>

      {dirty && <div className="admin-note admin-note--info" style={{ maxWidth: 760 }}><Save size={14}/><span>Unsaved changes — remember to save before leaving this page.</span></div>}

      <div className="admin-settings-section">
        <div className="admin-card__header">
          <span className="admin-card__title">Theme</span>
          <span className="admin-card__hint">Dark, white and mixed — applies immediately, persists in this browser</span>
        </div>
        <div className="admin-theme-grid" role="radiogroup" aria-label="Console theme">
          {ADMIN_THEMES.map(themeDef => (
            <button key={themeDef.id} type="button" role="radio" aria-checked={theme === themeDef.id}
              className="admin-theme-card" aria-pressed={theme === themeDef.id}
              onClick={() => setTheme(themeDef.id)}>
              <span className="admin-theme-card__swatch" aria-hidden="true">
                <span style={{ background: themeDef.swatch.chrome ?? themeDef.swatch.bg }}/>
                <span style={{ background: themeDef.swatch.bg }}/>
                <span style={{ background: themeDef.swatch.panel }}/>
                <span style={{ background: themeDef.swatch.accent }}/>
              </span>
              <span className="admin-theme-card__name">{themeDef.label}</span>
              <span className="admin-theme-card__kind">{KIND_LABELS[themeDef.kind]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="admin-settings-columns">
      <div className="admin-settings-section">
        <div className="admin-card__header"><span className="admin-card__title">General</span></div>
        <div className="admin-settings-grid">
          {field('Platform name', <input className="admin-input" value={draft.platformName} onChange={event => setDraft({ ...draft, platformName: event.target.value })}/>)}
          {field('Timezone', <select className="admin-select" value={draft.timezone} onChange={event => setDraft({ ...draft, timezone: event.target.value })}><option>Asia/Kolkata</option><option>UTC</option></select>, 'Day keys and resets use IST')}
          {field('Number formatting', <select className="admin-select" value={draft.numberFormatLocale} onChange={event => setDraft({ ...draft, numberFormatLocale: event.target.value as AdminSettings['numberFormatLocale'] })}><option value="en-IN">en-IN (Indian grouping)</option><option value="en-US">en-US</option></select>)}
          {field('Dashboard time range', <select className="admin-select" value={draft.defaultPeriod} onChange={event => setDraft({ ...draft, defaultPeriod: event.target.value as PeriodKey })}>{(Object.keys(PERIOD_LABELS) as PeriodKey[]).map(key => <option key={key} value={key}>{PERIOD_LABELS[key]}</option>)}</select>)}
          {switchField('Compact numbers', '1.2K / 3.4M in KPIs and charts', draft.compactNumbers, value => setDraft({ ...draft, compactNumbers: value }))}
        </div>
      </div>

      <div className="admin-settings-section">
        <div className="admin-card__header"><span className="admin-card__title">Account defaults</span><span className="admin-card__hint">for newly provisioned accounts once the backend exists</span></div>
        <div className="admin-settings-grid">
          {numberField('Daily free credits', 'Refilled at the reset time', draft.defaultDailyFreeCredits, value => setDraft({ ...draft, defaultDailyFreeCredits: value }))}
          {numberField('Monthly limit', 'Calendar-month cap', draft.defaultMonthlyLimit, value => setDraft({ ...draft, defaultMonthlyLimit: value }))}
          {field('Default role', <select className="admin-select" value={draft.defaultRole} onChange={event => setDraft({ ...draft, defaultRole: event.target.value as AccountRole })}><option value="user">User</option><option value="pro">Pro</option><option value="team">Team</option></select>)}
          {switchField('AI access by default', 'New accounts can use AI immediately', draft.defaultAiAccess, value => setDraft({ ...draft, defaultAiAccess: value }))}
        </div>
      </div>

      <div className="admin-settings-section">
        <div className="admin-card__header"><span className="admin-card__title">AI usage</span></div>
        <div className="admin-settings-grid">
          {field('Default model', <select className="admin-select" value={draft.defaultModelId} onChange={event => setDraft({ ...draft, defaultModelId: event.target.value })}>{models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select>)}
          {numberField('Max output tokens', 'Per-request ceiling', draft.defaultMaxOutputTokens, value => setDraft({ ...draft, defaultMaxOutputTokens: value }), 1)}
          {numberField('Credits / 1K input', 'Conversion rule', draft.creditRules.creditsPer1kInput, value => setDraft({ ...draft, creditRules: { ...draft.creditRules, creditsPer1kInput: value } }), 0, 1000)}
          {numberField('Credits / 1K output', 'Conversion rule', draft.creditRules.creditsPer1kOutput, value => setDraft({ ...draft, creditRules: { ...draft.creditRules, creditsPer1kOutput: value } }), 0, 1000)}
          {numberField('Cost markup %', 'On simulated provider prices', draft.costEstimation.markupPercent, value => setDraft({ ...draft, costEstimation: { ...draft.costEstimation, markupPercent: value } }), 0, 500)}
          {switchField('Bill failed requests', 'Count partial failures in cost totals', draft.costEstimation.includeFailedRequests, value => setDraft({ ...draft, costEstimation: { ...draft.costEstimation, includeFailedRequests: value } }))}
        </div>
      </div>

      <div className="admin-settings-section">
        <div className="admin-card__header"><span className="admin-card__title">Reset policies</span><Badge tone="admin-badge--amber">simulated</Badge></div>
        <div className="admin-settings-grid">
          {field('Daily reset (IST)', <input className="admin-input" type="time" value={draft.resetPolicies.dailyResetTime} onChange={event => setDraft({ ...draft, resetPolicies: { ...draft.resetPolicies, dailyResetTime: event.target.value || '00:00' } })}/>)}
          {numberField('Monthly reset day', 'Day of month (1-28)', draft.resetPolicies.monthlyResetDay, value => setDraft({ ...draft, resetPolicies: { ...draft.resetPolicies, monthlyResetDay: value } }), 1, 28)}
          {numberField('Promo validity (days)', 'Promotional credit expiry', draft.resetPolicies.promoValidityDays, value => setDraft({ ...draft, resetPolicies: { ...draft.resetPolicies, promoValidityDays: value } }), 1, 365)}
          {switchField('Unused daily credits expire', 'Allowance resets instead of accumulating', draft.resetPolicies.dailyCreditsExpire, value => setDraft({ ...draft, resetPolicies: { ...draft.resetPolicies, dailyCreditsExpire: value } }))}
          {switchField('Permanent credits carry over', 'Purchased credits never expire', draft.resetPolicies.permanentCarryOver, value => setDraft({ ...draft, resetPolicies: { ...draft.resetPolicies, permanentCarryOver: value } }))}
        </div>
      </div>

      <div className="admin-settings-section">
        <div className="admin-card__header"><span className="admin-card__title">Notification thresholds</span><span className="admin-card__hint">drive the simulated alerts and bell badges</span></div>
        <div className="admin-settings-grid">
          {numberField('Credit threshold', '% of daily allowance → "nearing limit" alert', draft.notifications.creditThresholdPercent, value => setDraft({ ...draft, notifications: { ...draft.notifications, creditThresholdPercent: value } }), 1, 100)}
          {numberField('Failed requests / hour', 'Failures before an alert', draft.notifications.failedRequestThreshold, value => setDraft({ ...draft, notifications: { ...draft.notifications, failedRequestThreshold: value } }), 1)}
          {numberField('Daily cost (₹)', 'Estimated spend before an alert', draft.notifications.dailyCostThresholdInr, value => setDraft({ ...draft, notifications: { ...draft.notifications, dailyCostThresholdInr: value } }), 1)}
          {numberField('Unusual consumption', '% above 30-day baseline → spike alert', draft.notifications.unusualConsumptionPercent, value => setDraft({ ...draft, notifications: { ...draft.notifications, unusualConsumptionPercent: value } }), 1)}
        </div>
      </div>

      <div className="admin-settings-section" style={{ borderColor: 'rgba(224,90,90,.4)' }}>
        <div className="admin-card__header"><span className="admin-card__title" style={{ color: '#f0a2a2' }}><Database size={13}/> Demo data</span></div>
        <div className="admin-settings-row">
          <div className="admin-settings-row__text"><strong>Reset demo data</strong><span>Clears localStorage (accounts, ledger edits, alerts, settings) and reseeds the original synthetic dataset.</span></div>
          <button className="admin-btn admin-btn--danger" onClick={() => setConfirmReset(true)}><RotateCcw size={13}/>Reset demo data</button>
        </div>
      </div>
      </div>

      <ConfirmDialog open={confirmReset} title="Reset demo data" tone="danger"
        body={<>This discards <strong>every change you have made</strong> in the admin console — account edits, credit adjustments, model configuration, alerts, audit entries and settings — and reseeds the original demo dataset. The rest of WireUp is not affected.</>}
        confirmLabel="Reset demo data" typedConfirmation="RESET"
        onClose={() => setConfirmReset(false)} onConfirm={resetDemoData}/>
    </div>
  )
}
