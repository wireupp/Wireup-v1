// Domain types for the WireUp admin console.
// Frontend-only prototype: these models are shaped so Firebase Auth/Firestore,
// Cloud Functions and Sarvam AI can replace the mock services later without
// changing the UI contracts.

export type AccountStatus = 'active' | 'suspended' | 'restricted' | 'pending'
export type AccountRole = 'user' | 'pro' | 'team' | 'admin'
export type RequestStatus = 'success' | 'failed' | 'rate_limited' | 'cancelled'
export type RequestType = 'chat' | 'circuit-design' | 'code-generation' | 'analysis' | 'explanation' | 'translation'
export type TransactionType = 'grant' | 'deduction' | 'usage' | 'refund' | 'daily_allocation' | 'promotional' | 'expiration' | 'reset'
export type CreditBucket = 'daily' | 'permanent' | 'promotional'
export type AlertSeverity = 'info' | 'warning' | 'high' | 'critical'
export type AlertStatus = 'unread' | 'acknowledged' | 'resolved' | 'dismissed'
export type PeriodKey = 'today' | '7d' | '30d' | '90d'

export interface CreditBalances {
  daily: number
  permanent: number
  promotional: number
}

export interface AccountLimits {
  daily: number
  monthly: number
  perRequest: number
}

export interface AccountUsage {
  /** Credits charged since the last daily reset. */
  dailyCreditsUsed: number
  /** Credits charged since the start of the current calendar month (IST). */
  monthlyCreditsUsed: number
  requestsToday: number
  lifetimeRequests: number
  lifetimeInputTokens: number
  lifetimeOutputTokens: number
  lifetimeCredits: number
}

export interface Account {
  id: string
  name: string
  email: string
  organization: string
  status: AccountStatus
  role: AccountRole
  aiEnabled: boolean
  createdAt: string
  lastActiveAt: string
  balances: CreditBalances
  promoExpiresAt: string | null
  limits: AccountLimits
  usage: AccountUsage
  /** IST day key of the last daily reset applied to this account (idempotency token). */
  dailyPeriodId: string
}

export interface AiRequest {
  id: string
  timestamp: string
  accountId: string
  providerId: string
  modelId: string
  type: RequestType
  inputTokens: number
  outputTokens: number
  creditsReserved: number
  creditsCharged: number
  creditsRefunded: number
  estimatedCostInr: number
  durationMs: number
  status: RequestStatus
  errorCategory: string | null
  retries: number
  promptPreview: string
}

export interface CreditTransaction {
  id: string
  timestamp: string
  accountId: string
  type: TransactionType
  /** Signed amount: grants positive, charges negative. */
  amount: number
  bucket: CreditBucket
  balanceBefore: number
  balanceAfter: number
  reason: string
  admin: string
  requestId?: string
}

export type AlertKind =
  | 'daily_limit_near'
  | 'token_spike'
  | 'high_cost'
  | 'failed_requests'
  | 'volume_spike'
  | 'abuse_suspected'
  | 'model_error_rate'
  | 'usage_discrepancy'
  | 'credit_inconsistency'

export interface AlertRecord {
  id: string
  kind: AlertKind
  severity: AlertSeverity
  status: AlertStatus
  /** Set when an administrator marks the alert as read, independent of acknowledge/resolve. */
  readAt: string | null
  createdAt: string
  title: string
  description: string
  accountId?: string
  requestId?: string
  modelId?: string
  metric?: string
}

export type AuditAction =
  | 'account.activated'
  | 'account.suspended'
  | 'account.restored'
  | 'account.restricted'
  | 'account.ai_enabled'
  | 'account.ai_disabled'
  | 'account.role_changed'
  | 'account.limits_changed'
  | 'account.daily_usage_reset'
  | 'credits.granted'
  | 'credits.deducted'
  | 'credits.promotional_granted'
  | 'reset.daily_triggered'
  | 'model.enabled'
  | 'model.disabled'
  | 'model.updated'
  | 'model.added'
  | 'provider.added'
  | 'pricing.changed'
  | 'ratelimits.changed'
  | 'settings.updated'
  | 'alert.acknowledged'
  | 'alert.resolved'
  | 'data.refreshed'
  | 'data.reset'

export interface AuditEvent {
  id: string
  timestamp: string
  admin: string
  action: AuditAction
  targetType: 'account' | 'model' | 'provider' | 'platform' | 'alert'
  targetId: string
  targetLabel: string
  before: string | null
  after: string | null
  reason: string | null
}

export interface ModelConfig {
  id: string
  providerId: string
  displayName: string
  enabled: boolean
  /** Simulated INR price per million input tokens — mock config until verified with the provider. */
  inputPricePerMillion: number
  /** Simulated INR price per million output tokens — mock config. */
  outputPricePerMillion: number
  /** Multiplier applied on top of the platform credit rules. */
  creditMultiplier: number
  maxOutputTokens: number
  maxCreditsPerRequest: number
  description: string
}

export interface ProviderConfig {
  id: string
  name: string
  status: 'connected' | 'planned'
  website: string
  note: string
}

/** Per-account daily aggregate. The last 7 days are derived from the request log; earlier days are seeded aggregates. */
export interface DailyUsage {
  day: string
  accountId: string
  requests: number
  failedRequests: number
  inputTokens: number
  outputTokens: number
  credits: number
  costInr: number
}

/** Platform-wide per-model daily aggregate (seeded demo data consistent with the daily usage plan). */
export interface ModelDailyUsage {
  day: string
  modelId: string
  requests: number
  inputTokens: number
  outputTokens: number
  credits: number
  costInr: number
  avgLatencyMs: number
  errors: number
}

export interface ResetHistoryEntry {
  id: string
  triggeredAt: string
  /** IST day key — the idempotency token for the reset. */
  periodId: string
  accountsAffected: number
  creditsReissued: number
  triggeredBy: string
}

export interface CreditRules {
  creditsPer1kInput: number
  creditsPer1kOutput: number
}

export interface ResetPolicies {
  /** 24h IST clock time of the daily reset, e.g. "00:00". */
  dailyResetTime: string
  /** Day of month the monthly allowance resets (1-28). */
  monthlyResetDay: number
  dailyCreditsExpire: boolean
  permanentCarryOver: boolean
  promoValidityDays: number
}

export interface NotificationSettings {
  creditThresholdPercent: number
  failedRequestThreshold: number
  dailyCostThresholdInr: number
  unusualConsumptionPercent: number
}

export interface AdminSettings {
  platformName: string
  timezone: string
  numberFormatLocale: 'en-IN' | 'en-US'
  compactNumbers: boolean
  defaultPeriod: PeriodKey
  defaultDailyFreeCredits: number
  defaultMonthlyLimit: number
  defaultRole: AccountRole
  defaultAiAccess: boolean
  defaultModelId: string
  defaultMaxOutputTokens: number
  creditRules: CreditRules
  costEstimation: { includeFailedRequests: boolean; markupPercent: number }
  resetPolicies: ResetPolicies
  notifications: NotificationSettings
}

export interface RateLimitModelRule {
  requestsPerDay: number
  maxOutputTokens: number
}

export interface RateLimitRoleRule {
  requestsPerDay: number
  dailyCredits: number
}

export interface RateLimitAccountOverride {
  requestsPerDay?: number
  dailyCredits?: number
  note?: string
}

export interface RateLimitConfig {
  requestsPerMinute: number
  requestsPerHour: number
  requestsPerDay: number
  maxConcurrentRequests: number
  maxInputTokensPerRequest: number
  maxOutputTokensPerRequest: number
  maxCreditsPerRequest: number
  globalRequestsPerMinute: number
  globalRequestsPerDay: number
  modelRules: Record<string, RateLimitModelRule>
  roleRules: Record<AccountRole, RateLimitRoleRule>
  accountOverrides: Record<string, RateLimitAccountOverride>
}

export interface Toast {
  id: string
  title: string
  description?: string
  tone: 'success' | 'error' | 'info'
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
}

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  chat: 'Chat',
  'circuit-design': 'Circuit design',
  'code-generation': 'Code generation',
  analysis: 'Analysis',
  explanation: 'Explanation',
  translation: 'Translation',
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  grant: 'Grant',
  deduction: 'Deduction',
  usage: 'Usage charge',
  refund: 'Refund',
  daily_allocation: 'Daily allocation',
  promotional: 'Promotional',
  expiration: 'Expiration',
  reset: 'Reset adjustment',
}

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  daily_limit_near: 'Daily credit limit',
  token_spike: 'Token consumption spike',
  high_cost: 'High API cost',
  failed_requests: 'Repeated failures',
  volume_spike: 'Request volume spike',
  abuse_suspected: 'Abuse suspected',
  model_error_rate: 'Model error rate',
  usage_discrepancy: 'Usage discrepancy',
  credit_inconsistency: 'Credit inconsistency',
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'account.activated': 'Account activated',
  'account.suspended': 'Account suspended',
  'account.restored': 'Account restored',
  'account.restricted': 'Account restricted',
  'account.ai_enabled': 'AI access enabled',
  'account.ai_disabled': 'AI access disabled',
  'account.role_changed': 'Role changed',
  'account.limits_changed': 'Limits changed',
  'account.daily_usage_reset': 'Daily usage reset',
  'credits.granted': 'Credits granted',
  'credits.deducted': 'Credits deducted',
  'credits.promotional_granted': 'Promotional credits granted',
  'reset.daily_triggered': 'Daily reset triggered',
  'model.enabled': 'Model enabled',
  'model.disabled': 'Model disabled',
  'model.updated': 'Model configuration updated',
  'model.added': 'Model added',
  'provider.added': 'Provider added',
  'pricing.changed': 'Pricing changed',
  'ratelimits.changed': 'Rate limits changed',
  'settings.updated': 'Settings updated',
  'alert.acknowledged': 'Alert acknowledged',
  'alert.resolved': 'Alert resolved',
  'data.refreshed': 'Dashboard data refreshed',
  'data.reset': 'Demo data reset',
}
