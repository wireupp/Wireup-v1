// Central admin store (zustand). All pages share this state: granting credits
// on the Credits page updates the Accounts table, account drawer, ledger and
// KPIs everywhere. Changes persist to localStorage so refreshes keep the demo
// world intact; Settings offers a full reset back to the seeded dataset.
//
// NOTE: this is a FRONTEND-ONLY prototype. No mutation here is authoritative —
// real deployments must move every privileged operation behind authenticated
// server endpoints, atomic Firestore transactions and scheduled Cloud Functions.

import { create } from 'zustand'
import { DEMO_ADMIN, buildMockDataset } from './mock-data'
import { addDaysToDayKey, istDayKey, istDayStartMs, nextIstOccurrence } from './format'
import type {
  Account, AccountRole, AccountStatus, AdminSettings, AiRequest, AlertRecord, AuditAction, AuditEvent,
  CreditTransaction, ModelConfig, ProviderConfig, RateLimitConfig, ResetHistoryEntry, Toast, TransactionType,
} from './types'

const STORAGE_KEY = 'wireup.admin-demo.v1'

interface PersistedState {
  version: 1
  accounts: Account[]
  requests: AiRequest[]
  transactions: CreditTransaction[]
  auditEvents: AuditEvent[]
  alerts: AlertRecord[]
  models: ModelConfig[]
  providers: ProviderConfig[]
  settings: AdminSettings
  rateLimits: RateLimitConfig
  resetHistory: ResetHistoryEntry[]
  lastRefreshedAt: string
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState
      if (parsed.version === 1 && Array.isArray(parsed.accounts) && Array.isArray(parsed.requests)) return parsed
    }
  } catch { /* corrupted state reseeds below */ }
  const seeded = buildMockDataset()
  return {
    version: 1,
    accounts: seeded.accounts, requests: seeded.requests, transactions: seeded.transactions,
    auditEvents: seeded.auditEvents, alerts: seeded.alerts, models: seeded.models, providers: seeded.providers,
    settings: seeded.settings, rateLimits: seeded.rateLimits, resetHistory: seeded.resetHistory,
    lastRefreshedAt: new Date(seeded.now).toISOString(),
  }
}

export interface CreditAdjustmentInput {
  mode: 'grant' | 'deduct' | 'promotional'
  amount: number
  reason: string
}

export interface AccountLimitsPatch { daily?: number; monthly?: number; perRequest?: number }

export interface ModelPatch {
  enabled?: boolean
  inputPricePerMillion?: number
  outputPricePerMillion?: number
  creditMultiplier?: number
  maxOutputTokens?: number
  maxCreditsPerRequest?: number
  displayName?: string
}

export interface ResetPreviewResult {
  periodId: string
  nextResetAt: string
  eligibleAccounts: Account[]
  creditsReissued: number
}

export interface AdminStore extends PersistedState {
  toasts: Toast[]
  demoSeededAt: string

  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void

  setAccountStatus: (accountId: string, status: AccountStatus, reason: string) => void
  setAccountRole: (accountId: string, role: AccountRole, reason: string) => void
  setAccountAiAccess: (accountId: string, enabled: boolean, reason: string) => void
  updateAccountLimits: (accountId: string, patch: AccountLimitsPatch, reason: string) => void
  resetAccountDailyUsage: (accountId: string) => void
  adjustCredits: (accountId: string, input: CreditAdjustmentInput) => boolean

  previewDailyReset: () => ResetPreviewResult
  applyDailyReset: (reason: string) => void

  updateModel: (modelId: string, patch: ModelPatch, reason: string) => void
  addModel: (input: { providerId: string; displayName: string; inputPricePerMillion: number; outputPricePerMillion: number; creditMultiplier: number; maxOutputTokens: number; maxCreditsPerRequest: number }) => void
  addProvider: (name: string) => void

  updateRateLimits: (config: RateLimitConfig, reason: string) => void
  updateSettings: (settings: AdminSettings, reason: string) => void

  markAlertRead: (alertId: string) => void
  acknowledgeAlert: (alertId: string) => void
  resolveAlert: (alertId: string) => void
  dismissAlert: (alertId: string) => void

  refreshData: () => void
  resetDemoData: () => void
}

let toastSeq = 1
let auditSeq = 1
let txSeq = 100_000

export const useAdminStore = create<AdminStore>()((set, get) => {
  const persisted = loadPersisted()

  const persist = () => {
    const state = get()
    const snapshot: PersistedState = {
      version: 1,
      accounts: state.accounts, requests: state.requests, transactions: state.transactions,
      auditEvents: state.auditEvents, alerts: state.alerts, models: state.models, providers: state.providers,
      settings: state.settings, rateLimits: state.rateLimits, resetHistory: state.resetHistory,
      lastRefreshedAt: state.lastRefreshedAt,
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)) } catch { /* storage full — demo continues in memory */ }
  }

  const logAudit = (action: AuditAction, target: { targetType: AuditEvent['targetType']; targetId: string; targetLabel: string }, before: string | null, after: string | null, reason: string | null) => {
    const event: AuditEvent = {
      id: `aud_n${String(auditSeq++).padStart(4, '0')}`,
      timestamp: new Date().toISOString(),
      admin: DEMO_ADMIN.name,
      action,
      targetType: target.targetType,
      targetId: target.targetId,
      targetLabel: target.targetLabel,
      before, after, reason: reason || null,
    }
    set(state => ({ auditEvents: [event, ...state.auditEvents] }))
  }

  const toast = (title: string, tone: Toast['tone'], description?: string) => {
    const id = `t${toastSeq++}`
    set(state => ({ toasts: [...state.toasts, { id, title, tone, description }] }))
  }

  const updateAccount = (accountId: string, mutate: (account: Account) => void) => {
    set(state => ({
      accounts: state.accounts.map(account => {
        if (account.id !== accountId) return account
        const next = { ...account, balances: { ...account.balances }, limits: { ...account.limits }, usage: { ...account.usage } }
        mutate(next)
        return next
      }),
    }))
  }

  return {
    ...persisted,
    toasts: [],
    demoSeededAt: persisted.lastRefreshedAt,

    pushToast: input => toast(input.title, input.tone, input.description),
    dismissToast: id => set(state => ({ toasts: state.toasts.filter(item => item.id !== id) })),

    // --- Accounts -----------------------------------------------------------
    setAccountStatus: (accountId, status, reason) => {
      const account = get().accounts.find(item => item.id === accountId)
      if (!account) return
      const before = account.status
      if (before === status) return
      updateAccount(accountId, next => {
        next.status = status
        if (status === 'active') next.aiEnabled = true
        if (status === 'suspended' || status === 'restricted') next.aiEnabled = false
      })
      const action: AuditAction = status === 'suspended' ? 'account.suspended' : status === 'restricted' ? 'account.restricted' : before === 'pending' ? 'account.activated' : 'account.restored'
      logAudit(action, { targetType: 'account', targetId: accountId, targetLabel: account.name }, before, status, reason)
      persist()
      toast(`Account ${status === 'active' ? 'activated' : status}`, 'success', `${account.name} — ${status}. Recorded in the audit log.`)
    },

    setAccountRole: (accountId, role, reason) => {
      const account = get().accounts.find(item => item.id === accountId)
      if (!account || account.role === role) return
      const before = account.role
      updateAccount(accountId, next => { next.role = role })
      logAudit('account.role_changed', { targetType: 'account', targetId: accountId, targetLabel: account.name }, before, role, reason)
      persist()
      toast('Role updated', 'success', `${account.name} is now ${role}.`)
    },

    setAccountAiAccess: (accountId, enabled, reason) => {
      const account = get().accounts.find(item => item.id === accountId)
      if (!account || account.aiEnabled === enabled) return
      updateAccount(accountId, next => { next.aiEnabled = enabled })
      logAudit(enabled ? 'account.ai_enabled' : 'account.ai_disabled', { targetType: 'account', targetId: accountId, targetLabel: account.name }, enabled ? 'disabled' : 'enabled', enabled ? 'enabled' : 'disabled', reason)
      persist()
      toast(`AI access ${enabled ? 'enabled' : 'disabled'}`, 'success', `${account.name}.`)
    },

    updateAccountLimits: (accountId, patch, reason) => {
      const account = get().accounts.find(item => item.id === accountId)
      if (!account) return
      const before = account.limits
      updateAccount(accountId, next => {
        if (patch.daily !== undefined) next.limits.daily = patch.daily
        if (patch.monthly !== undefined) next.limits.monthly = patch.monthly
        if (patch.perRequest !== undefined) next.limits.perRequest = patch.perRequest
      })
      const after = get().accounts.find(item => item.id === accountId)!.limits
      const describe = (limits: Account['limits']) => `daily ${limits.daily} / monthly ${limits.monthly} / per-request ${limits.perRequest}`
      logAudit('account.limits_changed', { targetType: 'account', targetId: accountId, targetLabel: account.name }, describe(before), describe(after), reason)
      persist()
      toast('Limits updated', 'success', `${account.name}: ${describe(after)}`)
    },

    resetAccountDailyUsage: accountId => {
      const account = get().accounts.find(item => item.id === accountId)
      if (!account) return
      const todayKey = istDayKey(new Date())
      updateAccount(accountId, next => {
        next.balances.daily = next.limits.daily
        next.usage.dailyCreditsUsed = 0
        next.dailyPeriodId = todayKey
      })
      logAudit('account.daily_usage_reset', { targetType: 'account', targetId: accountId, targetLabel: account.name }, `daily used ${account.usage.dailyCreditsUsed}`, '0', 'Manual daily usage reset')
      persist()
      toast('Daily usage reset', 'success', `${account.name}: daily allowance restored to ${account.limits.daily}. Usage history preserved.`)
    },

    adjustCredits: (accountId, input) => {
      const account = get().accounts.find(item => item.id === accountId)
      if (!account) return false
      if (!(input.amount > 0)) return false
      const nowIso = new Date().toISOString()
      const balances = { ...account.balances }
      let bucket: CreditTransaction['bucket'] = 'permanent'
      let type: TransactionType = 'grant'
      let delta = 0
      if (input.mode === 'grant') { balances.permanent += input.amount; delta = input.amount; type = 'grant'; bucket = 'permanent' }
      if (input.mode === 'promotional') {
        balances.promotional += input.amount; delta = input.amount; type = 'promotional'; bucket = 'promotional'
      }
      if (input.mode === 'deduct') {
        let remaining = input.amount
        const fromPermanent = Math.min(balances.permanent, remaining); balances.permanent -= fromPermanent; remaining -= fromPermanent
        const fromPromo = Math.min(balances.promotional, remaining); balances.promotional -= fromPromo; remaining -= fromPromo
        const fromDaily = Math.min(balances.daily, remaining); balances.daily -= fromDaily; remaining -= fromDaily
        if (remaining > 0) {
          toast('Insufficient balance', 'error', `${account.name} only has ${Math.round(input.amount - remaining)} credits to deduct.`)
          return false
        }
        delta = -input.amount
        type = 'deduction'
        bucket = fromPermanent >= input.amount ? 'permanent' : fromPromo > 0 ? 'promotional' : 'daily'
      }
      const totalBefore = Math.round((account.balances.daily + account.balances.permanent + account.balances.promotional) * 100) / 100
      const totalAfter = Math.round((balances.daily + balances.permanent + balances.promotional) * 100) / 100
      const transaction: CreditTransaction = {
        id: `txn_n${String(txSeq++).padStart(5, '0')}`,
        timestamp: nowIso,
        accountId,
        type,
        amount: delta,
        bucket,
        balanceBefore: totalBefore,
        balanceAfter: totalAfter,
        reason: input.reason || (type === 'grant' ? 'Manual grant' : type === 'promotional' ? 'Promotional grant' : 'Manual deduction'),
        admin: DEMO_ADMIN.name,
      }
      set(state => ({ transactions: [transaction, ...state.transactions] }))
      updateAccount(accountId, next => {
        next.balances = balances
        if (input.mode === 'promotional') next.promoExpiresAt = new Date(Date.now() + get().settings.resetPolicies.promoValidityDays * 86_400_000).toISOString()
      })
      const action: AuditAction = type === 'grant' ? 'credits.granted' : type === 'promotional' ? 'credits.promotional_granted' : 'credits.deducted'
      logAudit(action, { targetType: 'account', targetId: accountId, targetLabel: account.name }, `${totalBefore} credits`, `${totalAfter} credits`, transaction.reason)
      persist()
      toast(`${type === 'deduction' ? 'Deducted' : 'Granted'} ${input.amount} credits`, 'success', `${account.name}: ${totalBefore} → ${totalAfter}.`)
      return true
    },

    // --- Daily reset --------------------------------------------------------
    previewDailyReset: () => {
      const { accounts, settings } = get()
      const now = new Date()
      const periodId = istDayKey(now)
      const resetTime = settings.resetPolicies.dailyResetTime
      const nextReset = nextIstOccurrence(resetTime, now)
      // The active period is the IST day of the most recent configured reset time.
      const [hours, minutes] = resetTime.split(':').map(Number)
      const todayResetAt = istDayStartMs(periodId) + (hours * 60 + minutes) * 60_000
      const lastResetKey = todayResetAt <= now.getTime() ? periodId : addDaysToDayKey(periodId, -1)
      const eligible = accounts.filter(account =>
        (account.status === 'active' || account.status === 'restricted') && account.dailyPeriodId !== lastResetKey)
      return {
        periodId: lastResetKey,
        nextResetAt: nextReset.toISOString(),
        eligibleAccounts: eligible,
        creditsReissued: eligible.reduce((sum, account) => sum + account.limits.daily, 0),
      }
    },

    applyDailyReset: reason => {
      const preview = get().previewDailyReset()
      if (!preview.eligibleAccounts.length) {
        toast('Nothing to reset', 'info', `All eligible accounts are already on period ${preview.periodId} (idempotent).`)
        return
      }
      const nowIso = new Date().toISOString()
      const newTransactions: CreditTransaction[] = []
      for (const account of preview.eligibleAccounts) {
        updateAccount(account.id, next => {
          next.balances.daily = next.limits.daily
          next.usage.dailyCreditsUsed = 0
          next.dailyPeriodId = preview.periodId
        })
        newTransactions.push({
          id: `txn_n${String(txSeq++).padStart(5, '0')}`,
          timestamp: nowIso,
          accountId: account.id,
          type: 'daily_allocation',
          amount: account.limits.daily,
          bucket: 'daily',
          balanceBefore: Math.round((account.balances.daily + account.balances.permanent + account.balances.promotional) * 100) / 100,
          balanceAfter: Math.round((account.limits.daily + account.balances.permanent + account.balances.promotional) * 100) / 100,
          reason: `Daily free credits for ${preview.periodId} (IST)`,
          admin: DEMO_ADMIN.name,
        })
      }
      const entry: ResetHistoryEntry = {
        id: `rst_n${Date.now()}`,
        triggeredAt: nowIso,
        periodId: preview.periodId,
        accountsAffected: preview.eligibleAccounts.length,
        creditsReissued: preview.creditsReissued,
        triggeredBy: DEMO_ADMIN.name,
      }
      set(state => ({
        transactions: [...newTransactions.reverse(), ...state.transactions],
        resetHistory: [entry, ...state.resetHistory],
      }))
      logAudit('reset.daily_triggered', { targetType: 'platform', targetId: `reset:${preview.periodId}`, targetLabel: `Daily reset ${preview.periodId}` }, null, `${preview.eligibleAccounts.length} accounts reissued`, reason || 'Manual daily reset')
      persist()
      toast('Daily reset applied', 'success', `${preview.eligibleAccounts.length} accounts moved to period ${preview.periodId}. Historical usage preserved.`)
    },

    // --- Models & providers -------------------------------------------------
    updateModel: (modelId, patch, reason) => {
      const model = get().models.find(item => item.id === modelId)
      if (!model) return
      const before = { ...model }
      set(state => ({ models: state.models.map(item => item.id === modelId ? { ...item, ...patch } : item) }))
      const after = get().models.find(item => item.id === modelId)!
      if (patch.enabled !== undefined && patch.enabled !== before.enabled) {
        logAudit(patch.enabled ? 'model.enabled' : 'model.disabled', { targetType: 'model', targetId: modelId, targetLabel: after.displayName }, before.enabled ? 'enabled' : 'disabled', after.enabled ? 'enabled' : 'disabled', reason)
      } else if ((patch.inputPricePerMillion !== undefined || patch.outputPricePerMillion !== undefined) &&
        (patch.inputPricePerMillion !== before.inputPricePerMillion || patch.outputPricePerMillion !== before.outputPricePerMillion)) {
        logAudit('pricing.changed', { targetType: 'model', targetId: modelId, targetLabel: after.displayName }, `₹${before.inputPricePerMillion} in / ₹${before.outputPricePerMillion} out`, `₹${after.inputPricePerMillion} in / ₹${after.outputPricePerMillion} out`, reason)
      } else {
        logAudit('model.updated', { targetType: 'model', targetId: modelId, targetLabel: after.displayName }, null, null, reason)
      }
      persist()
      toast('Model updated', 'success', `${after.displayName} configuration saved (mock pricing).`)
    },

    addModel: input => {
      const id = input.displayName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `model-${Date.now()}`
      if (get().models.some(model => model.id === id)) {
        toast('Model ID already exists', 'error', `A model with the id "${id}" is already configured.`)
        return
      }
      const model: ModelConfig = {
        id, providerId: input.providerId, displayName: input.displayName, enabled: false,
        inputPricePerMillion: input.inputPricePerMillion, outputPricePerMillion: input.outputPricePerMillion,
        creditMultiplier: input.creditMultiplier, maxOutputTokens: input.maxOutputTokens,
        maxCreditsPerRequest: input.maxCreditsPerRequest,
        description: 'Added from the admin console. Mock configuration — verify the model ID and pricing with the provider before enabling.',
      }
      set(state => ({ models: [...state.models, model] }))
      logAudit('model.added', { targetType: 'model', targetId: id, targetLabel: input.displayName }, null, 'disabled (new)', 'Added via admin console')
      persist()
      toast('Model added', 'success', `${input.displayName} starts disabled until verified.`)
    },

    addProvider: name => {
      const id = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `provider-${Date.now()}`
      if (get().providers.some(provider => provider.id === id)) {
        toast('Provider already exists', 'error', `"${name}" is already configured.`)
        return
      }
      const provider: ProviderConfig = { id, name, status: 'planned', website: '', note: 'Added from the admin console. Connectivity is simulated — integrate the provider backend before enabling its models.' }
      set(state => ({ providers: [...state.providers, provider] }))
      logAudit('provider.added', { targetType: 'provider', targetId: id, targetLabel: name }, null, 'planned', 'Added via admin console')
      persist()
      toast('Provider added', 'success', `${name} is listed as planned.`)
    },

    // --- Platform config ----------------------------------------------------
    updateRateLimits: (config, reason) => {
      const before = get().rateLimits
      set({ rateLimits: config })
      logAudit('ratelimits.changed', { targetType: 'platform', targetId: 'platform', targetLabel: 'Rate limits & access policies' }, `${before.requestsPerMinute} rpm / ${before.requestsPerDay} per day`, `${config.requestsPerMinute} rpm / ${config.requestsPerDay} per day`, reason)
      persist()
      toast('Rate limits saved', 'success', 'Policies are stored in frontend state only — no server-side enforcement yet.')
    },

    updateSettings: (settings, reason) => {
      const before = get().settings
      set({ settings })
      logAudit('settings.updated', { targetType: 'platform', targetId: 'settings', targetLabel: 'Admin settings' }, `daily credits ${before.defaultDailyFreeCredits}`, `daily credits ${settings.defaultDailyFreeCredits}`, reason)
      persist()
      toast('Settings saved', 'success', 'Stored in localStorage for this prototype.')
    },

    // --- Alerts -------------------------------------------------------------
    markAlertRead: alertId => {
      const alert = get().alerts.find(item => item.id === alertId)
      if (!alert || alert.readAt) return
      set(state => ({ alerts: state.alerts.map(item => item.id === alertId ? { ...item, readAt: new Date().toISOString() } : item) }))
      persist()
    },

    acknowledgeAlert: alertId => {
      const alert = get().alerts.find(item => item.id === alertId)
      if (!alert) return
      set(state => ({ alerts: state.alerts.map(item => item.id === alertId ? { ...item, status: 'acknowledged', readAt: item.readAt ?? new Date().toISOString() } : item) }))
      logAudit('alert.acknowledged', { targetType: 'alert', targetId: alertId, targetLabel: alert.title }, alert.status, 'acknowledged', null)
      persist()
      toast('Alert acknowledged', 'info', alert.title)
    },

    resolveAlert: alertId => {
      const alert = get().alerts.find(item => item.id === alertId)
      if (!alert) return
      set(state => ({ alerts: state.alerts.map(item => item.id === alertId ? { ...item, status: 'resolved', readAt: item.readAt ?? new Date().toISOString() } : item) }))
      logAudit('alert.resolved', { targetType: 'alert', targetId: alertId, targetLabel: alert.title }, alert.status, 'resolved', null)
      persist()
      toast('Alert resolved', 'success', alert.title)
    },

    dismissAlert: alertId => {
      const alert = get().alerts.find(item => item.id === alertId)
      if (!alert) return
      set(state => ({ alerts: state.alerts.map(item => item.id === alertId ? { ...item, status: 'dismissed', readAt: item.readAt ?? new Date().toISOString() } : item) }))
      persist()
      toast('Alert dismissed', 'info', alert.title)
    },

    // --- Data lifecycle -----------------------------------------------------
    refreshData: () => {
      set({ lastRefreshedAt: new Date().toISOString() })
      logAudit('data.refreshed', { targetType: 'platform', targetId: 'dashboard', targetLabel: 'Dashboard data' }, null, null, 'Manual refresh (simulated)')
      persist()
      toast('Dashboard refreshed', 'info', 'Mock data recomputed. No backend call is made in demo mode.')
    },

    resetDemoData: () => {
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      logAudit('data.reset', { targetType: 'platform', targetId: 'demo-data', targetLabel: 'Demo dataset' }, null, 'reseeded', 'Reset demo data requested')
      window.location.reload()
    },
  }
})

// Re-exported so components can import both from the store module.
export { DEMO_ADMIN }
export const istDayStart = (day: string): number => istDayStartMs(day)
