// Deterministic mock dataset for the admin console. A fixed PRNG seed keeps the
// seeded world stable; the seed anchor is "now", so timestamps always look fresh.
// Everything here is synthetic demo data — no real accounts, requests or pricing.

import { calculateCreditCharge, estimateApiCostInr } from './credits'
import { addDaysToDayKey, istDayKey, istDayStartMs, istMonthKey } from './format'
import type {
  Account, AdminSettings, AiRequest, AlertRecord, AlertSeverity, AuditAction, AuditEvent,
  CreditTransaction, ModelConfig, ProviderConfig, RateLimitConfig, RequestStatus, RequestType,
  ResetHistoryEntry, TransactionType,
} from './types'

export const DEMO_ADMIN = { name: 'Aarav Mehta', email: 'aarav@wireup.dev', role: 'Administrator' }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(rng: () => number, items: T[]): T => items[Math.floor(rng() * items.length)]
const pickWeighted = <T,>(rng: () => number, items: [T, number][]): T => {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = rng() * total
  for (const [item, weight] of items) { roll -= weight; if (roll <= 0) return item }
  return items[items.length - 1][0]
}
const int = (rng: () => number, min: number, max: number): number => Math.floor(rng() * (max - min + 1)) + min

const PROVIDERS: ProviderConfig[] = [
  { id: 'sarvam', name: 'Sarvam AI', status: 'connected', website: 'https://sarvam.ai', note: 'Primary AI provider for all WireUp AI features. Mock connectivity status — no live API call is made.' },
  { id: 'zenllm-gateway', name: 'ZenLLM Gateway', status: 'planned', website: '', note: 'Planned multi-model gateway for fallback routing. Not connected — configuration shown for planning only.' },
]

const MODELS: ModelConfig[] = [
  { id: 'sarvam-m', providerId: 'sarvam', displayName: 'Sarvam-M (flagship)', enabled: true, inputPricePerMillion: 8, outputPricePerMillion: 24, creditMultiplier: 1, maxOutputTokens: 4096, maxCreditsPerRequest: 120, description: 'Flagship text generation. Mock model ID and pricing until verified with Sarvam AI.' },
  { id: 'sarvam-m-lite', providerId: 'sarvam', displayName: 'Sarvam-M Lite', enabled: true, inputPricePerMillion: 2, outputPricePerMillion: 8, creditMultiplier: 0.6, maxOutputTokens: 2048, maxCreditsPerRequest: 60, description: 'Lightweight model for quick chat replies. Mock configuration.' },
  { id: 'sarvam-chat-v1', providerId: 'sarvam', displayName: 'Sarvam Chat v1', enabled: true, inputPricePerMillion: 4, outputPricePerMillion: 12, creditMultiplier: 0.8, maxOutputTokens: 3072, maxCreditsPerRequest: 80, description: 'Conversational baseline model. Mock configuration.' },
  { id: 'mayura-v2', providerId: 'sarvam', displayName: 'Mayura v2 (translation)', enabled: true, inputPricePerMillion: 3, outputPricePerMillion: 9, creditMultiplier: 0.7, maxOutputTokens: 2048, maxCreditsPerRequest: 60, description: 'Indic translation model. Mock model ID and pricing.' },
  { id: 'saarika-v2', providerId: 'sarvam', displayName: 'Saarika v2 (analysis)', enabled: true, inputPricePerMillion: 5, outputPricePerMillion: 15, creditMultiplier: 0.9, maxOutputTokens: 3072, maxCreditsPerRequest: 90, description: 'Long-context circuit analysis. Mock model ID and pricing.' },
  { id: 'gateway-large-preview', providerId: 'zenllm-gateway', displayName: 'Gateway Large (preview)', enabled: false, inputPricePerMillion: 70, outputPricePerMillion: 280, creditMultiplier: 2.5, maxOutputTokens: 8192, maxCreditsPerRequest: 200, description: 'Planned premium fallback once the gateway is connected. Pricing is a placeholder.' },
]

const ACCOUNT_SEEDS: [string, string, string][] = [
  ['Ishaan Sharma', 'ishaan.sharma@gmail.com', 'Indie builder'], ['Ananya Iyer', 'ananya.iyer@veltech.edu.in', 'Veltech University'],
  ['Rohan Gupta', 'rohan@guptalabs.in', 'Gupta Labs'], ['Priya Nair', 'priya.nair@tinkerhouse.io', 'TinkerHouse'],
  ['Arjun Patel', 'arjun.patel@gmail.com', 'Indie builder'], ['Sneha Reddy', 'sneha.reddy@iiit.ac.in', 'IIIT Hyderabad'],
  ['Vikram Singh', 'vikram@circuitwala.in', 'CircuitWala'], ['Meera Krishnan', 'meera.k@psgtech.ac.in', 'PSG Tech'],
  ['Kabir Malhotra', 'kabir.malhotra@outlook.com', 'Indie builder'], ['Divya Menon', 'divya.menon@fusionkit.dev', 'FusionKit'],
  ['Aditya Rao', 'aditya.rao@robopark.in', 'RoboPark'], ['Kavya Desai', 'kavya.desai@gmail.com', 'Indie builder'],
  ['Rahul Verma', 'rahul.verma@delptronics.com', 'Delptronics'], ['Nisha Pillai', 'nisha.pillai@vitstudent.ac.in', 'VIT'],
  ['Siddharth Joshi', 'sid.joshi@makervalley.in', 'Maker Valley'], ['Tanvi Kulkarni', 'tanvi.k@coep.org.in', 'COEP'],
  ['Karan Bhatt', 'karan.bhatt@gmail.com', 'Indie builder'], ['Riya Chatterjee', 'riya.c@jadvpur.edu.in', 'Jadavpur University'],
  ['Nikhil Shetty', 'nikhil.shetty@dronekarti.in', 'DroneKart'], ['Pooja Hegde', 'pooja.hegde@gmail.com', 'Indie builder'],
  ['Aryan Kapoor', 'aryan.kapoor@stemlabs.education', 'STEM Labs'], ['Lakshmi Subramanian', 'lakshmi.s@nitk.edu.in', 'NITK'],
  ['Dev Malviya', 'dev.malviya@kavachsec.in', 'Kavach Sec'], ['Ira Bose', 'ira.bose@hci-lab.in', 'HCI Lab'],
  ['Yash Agarwal', 'yash.agarwal@gmail.com', 'Indie builder'], ['Saanvi Khanna', 'saanvi.khanna@diyabot.club', 'DiyaBot Club'],
  ['Aditi Ghosh', 'aditi.ghosh@innov8fab.in', 'Innov8Fab'], ['Manav Chauhan', 'manav.chauhan@gmail.com', 'Indie builder'],
  ['Trisha Annamaneni', 'trisha.a@srmap.edu.in', 'SRM AP'], ['Zoya Khan', 'zoya.khan@fluxmbed.io', 'Fluxmbed'],
  ['Harshit Bansal', 'harshit.bansal@gmail.com', 'Indie builder'], ['Nithya Raman', 'nithya.raman@ashoka.edu.in', 'Ashoka University'],
]

const PROMPT_SAMPLES: Record<RequestType, string[]> = {
  chat: ['How do I power a servo with the 5V pin?', 'Explain pull-up resistors for I2C', 'Why is my ESP32 rebooting in a loop?'],
  'circuit-design': ['Arduino Uno + 2 LEDs + button with debounce', 'ESP32 temperature logger with deep sleep', 'Motor driver L298N with two DC motors'],
  'code-generation': ['Write Arduino sketch for ultrasonic parking sensor', 'Generate ESP-IDF task for sensor polling', 'Debounce helper function for 4 buttons'],
  analysis: ['Why does my voltage divider sag under load?', 'Analyse current draw across the whole circuit', 'Check I2C bus timing against the datasheet'],
  explanation: ['How does a bootstrap capacitor work?', 'Difference between UART, SPI and I2C', 'What does the status LED blink pattern mean?'],
  translation: ['Translate wiring guide to Hindi', 'Translate safety notes to Tamil', 'Localise setup steps to Kannada'],
}

const MANUAL_REASONS = ['Goodwill credit for support ticket', 'Hackathon participant bonus', 'Compensation for failed request batch', 'Beta tester reward', 'Billing adjustment after review']
const ADMIN_NAMES = [DEMO_ADMIN.name, 'Priya Raghavan', 'Devansh Kulkarni']

const ERROR_CATEGORIES = ['provider_timeout', 'invalid_request', 'model_overloaded', 'content_filter', 'upstream_error']
const CREDIT_RULES_SEED = { creditsPer1kInput: 2, creditsPer1kOutput: 6 }

const MODEL_REQUEST_PROFILE: Record<string, { types: [RequestType, number][]; input: [number, number]; output: [number, number] }> = {
  'sarvam-m': { types: [['chat', 5], ['circuit-design', 3], ['code-generation', 3], ['analysis', 1]], input: [400, 5200], output: [300, 3200] },
  'sarvam-m-lite': { types: [['chat', 6], ['explanation', 4], ['code-generation', 1]], input: [150, 1400], output: [80, 900] },
  'sarvam-chat-v1': { types: [['chat', 7], ['explanation', 3]], input: [200, 2200], output: [100, 1400] },
  'mayura-v2': { types: [['translation', 8], ['explanation', 2]], input: [300, 2600], output: [250, 2400] },
  'saarika-v2': { types: [['analysis', 7], ['circuit-design', 2], ['code-generation', 1]], input: [1200, 5600], output: [400, 2800] },
}

export interface MockDataset {
  now: number
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
}

interface LedgerState { daily: number; permanent: number; promotional: number }
const totalBalance = (state: LedgerState): number => Math.round((state.daily + state.permanent + state.promotional) * 100) / 100

export function buildMockDataset(): MockDataset {
  const now = Date.now()
  const rng = mulberry32(0x5eed_2026)
  const todayKey = istDayKey(new Date(now))
  const monthKey = istMonthKey(new Date(now))
  const todayStart = istDayStartMs(todayKey)

  // --- Accounts -------------------------------------------------------------
  const heavyIds = ['acc_004', 'acc_013', 'acc_021']
  const smallDailyLimits: Record<string, number> = { acc_004: 180, acc_013: 160, acc_021: 200 }
  const accounts: Account[] = ACCOUNT_SEEDS.map(([name, email, organization], index) => {
    const id = `acc_${String(index + 1).padStart(3, '0')}`
    const status = index === 7 ? 'suspended' : index === 19 ? 'suspended' : index === 11 ? 'restricted' : index === 26 ? 'restricted' : index === 31 ? 'pending' : 'active'
    const role = index === 0 ? 'admin' : [4, 13, 21, 27].includes(index) ? 'pro' : [8, 16].includes(index) ? 'team' : 'user'
    const daily = smallDailyLimits[id] ?? int(rng, 400, 900)
    const createdAt = new Date(now - int(rng, 12, 420) * 86_400_000 - int(rng, 0, 80_000_000)).toISOString()
    const lastActive = status === 'suspended' ? new Date(now - int(rng, 6, 30) * 86_400_000).toISOString() : new Date(now - int(rng, 0, 52) * 3_600_000 - int(rng, 0, 3_600_000)).toISOString()
    return {
      id, name, email, organization, status, role,
      aiEnabled: status === 'active' || status === 'pending',
      createdAt, lastActiveAt: lastActive,
      balances: { daily: daily, permanent: 0, promotional: 0 },
      promoExpiresAt: null,
      limits: { daily, monthly: daily * 30, perRequest: int(rng, 40, 100) },
      usage: { dailyCreditsUsed: 0, monthlyCreditsUsed: 0, requestsToday: 0, lifetimeRequests: 0, lifetimeInputTokens: 0, lifetimeOutputTokens: 0, lifetimeCredits: 0 },
      dailyPeriodId: '',
    }
  })
  const accountById = new Map(accounts.map(account => [account.id, account]))

  // --- AI requests (21-day window, heavier today) ----------------------------
  const requests: AiRequest[] = []
  const enabledModels = MODELS.filter(model => model.enabled && model.providerId === 'sarvam')
  let requestSeq = 1
  for (let daysAgo = 20; daysAgo >= 0; daysAgo--) {
    const dayKey = addDaysToDayKey(todayKey, -daysAgo)
    const dayStart = istDayStartMs(dayKey)
    const count = daysAgo === 0 ? 58 : daysAgo === 1 ? 14 : int(rng, 6, 9)
    for (let i = 0; i < count; i++) {
      const account = daysAgo === 0 && i < 24
        ? accountById.get(heavyIds[i % heavyIds.length])!
        : pickWeighted(rng, accounts.map(a => [a, a.status === 'active' ? 10 : a.status === 'restricted' ? 2 : 0.4]) as [Account, number][])
      const model = pickWeighted(rng, enabledModels.map(m => [m, m.id === 'sarvam-m' ? 30 : m.id === 'sarvam-m-lite' ? 24 : m.id === 'sarvam-chat-v1' ? 20 : m.id === 'saarika-v2' ? 14 : 12]) as [ModelConfig, number][])
      const profile = MODEL_REQUEST_PROFILE[model.id]
      const type = pickWeighted(rng, profile.types)
      const inputTokens = int(rng, profile.input[0], profile.input[1])
      const outputTokens = int(rng, profile.output[0], profile.output[1])
      const status: RequestStatus = pickWeighted(rng, [['success', 91], ['failed', 4.5], ['rate_limited', 3], ['cancelled', 1.5]] as [RequestStatus, number][])
      const heavySlowdown = heavyIds.includes(account.id) ? 1.25 : 1
      const durationMs = status === 'success' ? int(rng, 600, 7200) : status === 'rate_limited' ? int(rng, 40, 220) : status === 'cancelled' ? int(rng, 200, 4200) : int(rng, 300, 2600)
      const chargeBase = calculateCreditCharge(inputTokens, outputTokens, model, CREDIT_RULES_SEED)
      const creditsReserved = Math.ceil(chargeBase)
      const creditsCharged = status === 'success' ? creditsReserved : status === 'failed' && rng() < 0.3 ? Math.ceil(creditsReserved / 2) : 0
      const timestamp = daysAgo === 0
        ? new Date(todayStart + Math.floor(rng() * Math.max(60_000, now - todayStart))).toISOString()
        : new Date(dayStart + (9 * 3600 + int(rng, 0, 13 * 3600)) * 1000 + int(rng, 0, 3_540_000)).toISOString()
      requests.push({
        id: `req_${String(requestSeq++).padStart(5, '0')}`,
        timestamp, accountId: account.id, providerId: model.providerId, modelId: model.id, type,
        inputTokens, outputTokens,
        creditsReserved, creditsCharged, creditsRefunded: creditsReserved - creditsCharged,
        estimatedCostInr: estimateApiCostInr(inputTokens, outputTokens, model),
        durationMs: Math.round(durationMs * heavySlowdown),
        status,
        errorCategory: status === 'failed' ? pick(rng, ERROR_CATEGORIES) : status === 'rate_limited' ? 'rate_limit_exceeded' : null,
        retries: status === 'rate_limited' ? int(rng, 1, 2) : status === 'failed' && rng() < 0.4 ? 1 : 0,
        promptPreview: pick(rng, PROMPT_SAMPLES[type]),
      })
    }
  }
  requests.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  // --- Credit ledger (walked per account so balances reconcile) ---------------
  const transactions: CreditTransaction[] = []
  let txSeq = 1
  interface LedgerEvent { at: number; apply: (state: LedgerState) => number; meta: Omit<CreditTransaction, 'id' | 'timestamp' | 'accountId' | 'balanceBefore' | 'balanceAfter'> }
  const ledgerEvents = new Map<string, LedgerEvent[]>()
  const addEvent = (accountId: string, at: number, meta: Omit<CreditTransaction, 'id' | 'timestamp' | 'accountId' | 'balanceBefore' | 'balanceAfter'>, apply: (state: LedgerState) => number) => {
    if (!ledgerEvents.has(accountId)) ledgerEvents.set(accountId, [])
    ledgerEvents.get(accountId)!.push({ at, apply, meta })
  }

  for (const account of accounts) {
    addEvent(account.id, new Date(account.createdAt).getTime(), {
      type: 'grant' as TransactionType, amount: 1000, bucket: 'permanent',
      reason: 'Welcome grant — new account', admin: 'system',
    }, state => { state.permanent += 1000; return 0 })
    if (['acc_002', 'acc_009', 'acc_015', 'acc_022', 'acc_028', 'acc_030'].includes(account.id)) {
      const grantAt = now - int(rng, 10, 25) * 86_400_000
      addEvent(account.id, grantAt, {
        type: 'promotional' as TransactionType, amount: 500, bucket: 'promotional',
        reason: 'Promotional credits — Diwali maker campaign', admin: ADMIN_NAMES[1],
      }, state => { state.promotional += 500; account.promoExpiresAt = new Date(grantAt + 30 * 86_400_000).toISOString(); return 0 })
    }
    if (['acc_006', 'acc_017'].includes(account.id)) {
      addEvent(account.id, now - int(rng, 40, 60) * 86_400_000, {
        type: 'expiration' as TransactionType, amount: -300, bucket: 'promotional',
        reason: 'Promotional credits expired', admin: 'system',
      }, state => { state.promotional = Math.max(0, state.promotional - 300); return 0 })
    }
  }
  // Daily allocations for the request window + usage charges from the request log.
  for (let daysAgo = 20; daysAgo >= 0; daysAgo--) {
    const dayKey = addDaysToDayKey(todayKey, -daysAgo)
    const resetAt = istDayStartMs(dayKey)
    for (const account of accounts) {
      if (account.status === 'suspended' || account.status === 'pending') continue
      if (resetAt < new Date(account.createdAt).getTime()) continue
      const override = account.id === 'acc_011' ? 250 : 0
      addEvent(account.id, resetAt, {
        type: 'daily_allocation' as TransactionType, amount: override || account.limits.daily, bucket: 'daily',
        reason: `Daily free credits for ${dayKey} (IST)`, admin: 'system', requestId: undefined,
      }, state => { state.daily = override || account.limits.daily; return 0 })
    }
  }
  for (const request of requests) {
    if (request.creditsCharged <= 0) continue
    const account = accountById.get(request.accountId)!
    if (account.status === 'suspended' || account.status === 'pending') continue
    const charged = request.creditsCharged
    addEvent(account.id, new Date(request.timestamp).getTime() + request.durationMs, {
      type: 'usage' as TransactionType, amount: -charged, bucket: 'daily',
      reason: `${request.modelId} usage`, admin: 'system', requestId: request.id,
    }, state => {
      let remaining = charged
      const fromDaily = Math.min(state.daily, remaining); state.daily -= fromDaily; remaining -= fromDaily
      const fromPromo = Math.min(state.promotional, remaining); state.promotional -= fromPromo; remaining -= fromPromo
      state.permanent -= remaining
      // Bucket hint for the ledger row: 0 = covered by daily, 1 = drew on permanent, 2 = mixed/promotional.
      if (fromDaily === charged) return 0
      return fromPromo > 0 ? 2 : 1
    })
  }
  // Manual admin adjustments.
  for (let i = 0; i < 12; i++) {
    const account = pick(rng, accounts)
    const isGrant = rng() < 0.75
    const amount = int(rng, 2, 15) * 50
    const at = now - int(rng, 1, 18) * 86_400_000 - int(rng, 0, 60_000_000)
    addEvent(account.id, at, {
      type: isGrant ? 'grant' : 'deduction', amount: isGrant ? amount : -amount, bucket: 'permanent',
      reason: pick(rng, MANUAL_REASONS), admin: pick(rng, ADMIN_NAMES),
    }, state => {
      if (isGrant) state.permanent += amount
      else state.permanent = Math.max(0, state.permanent - amount)
      return 0
    })
  }

  for (const [accountId, events] of ledgerEvents) {
    events.sort((a, b) => a.at - b.at)
    const state: LedgerState = { daily: 0, permanent: 0, promotional: 0 }
    for (const event of events) {
      const before = totalBalance(state)
      const bucketHint = event.apply(state)
      const meta = { ...event.meta }
      if (meta.type === 'usage') meta.bucket = bucketHint === 0 ? 'daily' : bucketHint === 1 ? 'permanent' : 'promotional'
      const after = totalBalance(state)
      transactions.push({
        id: `txn_${String(txSeq++).padStart(5, '0')}`, timestamp: new Date(event.at).toISOString(),
        accountId, balanceBefore: before, balanceAfter: after, ...meta,
      })
    }
    const account = accountById.get(accountId)!
    account.balances = { ...state }
    account.dailyPeriodId = todayKey
  }
  transactions.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  // --- Derive usage counters from the request log ----------------------------
  for (const request of requests) {
    const account = accountById.get(request.accountId)
    if (!account) continue
    account.usage.lifetimeRequests += 1
    account.usage.lifetimeInputTokens += request.inputTokens
    account.usage.lifetimeOutputTokens += request.outputTokens
    account.usage.lifetimeCredits += request.creditsCharged
    if (istDayKey(request.timestamp) === todayKey) {
      account.usage.requestsToday += 1
      account.usage.dailyCreditsUsed += request.creditsCharged
    }
    if (istMonthKey(request.timestamp) === monthKey) account.usage.monthlyCreditsUsed += request.creditsCharged
  }

  // --- Alerts ----------------------------------------------------------------
  const heavyAlertAccounts = heavyIds.map(id => accountById.get(id)!)
  const failureRequest = requests.find(request => request.status === 'failed')!
  const rateLimitedRequest = requests.find(request => request.status === 'rate_limited')!
  const alerts: AlertRecord[] = [
    { id: 'alr_001', kind: 'daily_limit_near', severity: 'warning', status: 'unread', readAt: null, createdAt: new Date(now - 2 * 3_600_000).toISOString(), title: `Account nearing daily credit limit`, description: `${heavyAlertAccounts[0].name} has consumed ${Math.round((heavyAlertAccounts[0].usage.dailyCreditsUsed / heavyAlertAccounts[0].limits.daily) * 100)}% of the daily allowance.`, accountId: heavyAlertAccounts[0].id, metric: 'daily credits' },
    { id: 'alr_002', kind: 'daily_limit_near', severity: 'high', status: 'unread', readAt: null, createdAt: new Date(now - 3 * 3_600_000).toISOString(), title: `Account nearing daily credit limit`, description: `${heavyAlertAccounts[1].name} is at ${Math.round((heavyAlertAccounts[1].usage.dailyCreditsUsed / heavyAlertAccounts[1].limits.daily) * 100)}% of the daily allowance with sustained request volume.`, accountId: heavyAlertAccounts[1].id, metric: 'daily credits' },
    { id: 'alr_003', kind: 'volume_spike', severity: 'high', status: 'unread', readAt: null, createdAt: new Date(now - 4 * 3_600_000).toISOString(), title: 'Request volume spike detected', description: `Request volume today is significantly above the trailing 7-day average. Pattern matches ${heavyAlertAccounts[2].name}'s automation script.`, accountId: heavyAlertAccounts[2].id, metric: 'requests/hour' },
    { id: 'alr_004', kind: 'abuse_suspected', severity: 'critical', status: 'acknowledged', readAt: new Date(now - 6 * 3_600_000).toISOString(), createdAt: new Date(now - 6 * 3_600_000).toISOString(), title: 'Potential repeated-request abuse', description: 'Identical prompt submitted 40+ times within one hour from a single account. Review before the next daily reset.', accountId: heavyAlertAccounts[1].id, metric: 'repeat prompts' },
    { id: 'alr_005', kind: 'failed_requests', severity: 'warning', status: 'acknowledged', readAt: new Date(now - 9 * 3_600_000).toISOString(), createdAt: new Date(now - 9 * 3_600_000).toISOString(), title: 'Repeated failed AI requests', description: `Multiple ${failureRequest.errorCategory} failures from one account in the last hour.`, accountId: failureRequest.accountId, requestId: failureRequest.id, metric: 'failure rate' },
    { id: 'alr_006', kind: 'high_cost', severity: 'warning', status: 'resolved', readAt: new Date(now - 26 * 3_600_000).toISOString(), createdAt: new Date(now - 26 * 3_600_000).toISOString(), title: 'Unusually high estimated API cost', description: 'Estimated Sarvam API cost for the hour exceeded ₹120 (simulated pricing).', metric: 'est. cost/hour' },
    { id: 'alr_007', kind: 'model_error_rate', severity: 'high', status: 'resolved', readAt: new Date(now - 30 * 3_600_000).toISOString(), createdAt: new Date(now - 30 * 3_600_000).toISOString(), title: 'Model error rate increased', description: 'sarvam-chat-v1 error rate crossed 6% for 20 minutes (simulated monitoring).', modelId: 'sarvam-chat-v1', metric: 'error rate' },
    { id: 'alr_008', kind: 'token_spike', severity: 'info', status: 'resolved', readAt: new Date(now - 2 * 86_400_000).toISOString(), createdAt: new Date(now - 2 * 86_400_000).toISOString(), title: 'Token consumption above expectation', description: 'Output tokens per request 2.3× the 30-day baseline during the evening block.', metric: 'tokens/request' },
    { id: 'alr_009', kind: 'usage_discrepancy', severity: 'info', status: 'dismissed', readAt: new Date(now - 3 * 86_400_000).toISOString(), createdAt: new Date(now - 3 * 86_400_000).toISOString(), title: 'Usage tracking discrepancy', description: 'Seeded aggregate totals differ from the visible request log for days outside the 21-day record window (expected demo behaviour).', metric: 'accounting' },
    { id: 'alr_010', kind: 'volume_spike', severity: 'warning', status: 'unread', readAt: null, createdAt: new Date(now - 90 * 60_000).toISOString(), title: 'Rate-limited requests observed', description: `${rateLimitedRequest.accountId} hit the per-minute mock rate limit; requests were rejected before execution.`, accountId: rateLimitedRequest.accountId, requestId: rateLimitedRequest.id, metric: 'rate limit' },
  ]

  // --- Audit history ---------------------------------------------------------
  const auditEvents: AuditEvent[] = [
    { id: 'aud_001', timestamp: new Date(now - 5 * 86_400_000).toISOString(), admin: ADMIN_NAMES[1], action: 'account.role_changed', targetType: 'account', targetId: 'acc_013', targetLabel: 'Rahul Verma', before: 'user', after: 'pro', reason: 'Upgraded after team plan purchase' },
    { id: 'aud_002', timestamp: new Date(now - 4 * 86_400_000).toISOString(), admin: ADMIN_NAMES[0], action: 'account.suspended', targetType: 'account', targetId: 'acc_020', targetLabel: 'Pooja Hegde', before: 'active', after: 'suspended', reason: 'Repeated abuse warnings ignored' },
    { id: 'aud_003', timestamp: new Date(now - 4 * 86_400_000 + 3_600_000).toISOString(), admin: ADMIN_NAMES[0], action: 'credits.granted', targetType: 'account', targetId: 'acc_020', targetLabel: 'Pooja Hegde', before: null, after: '500 credits', reason: 'Compensation for failed request batch' },
    { id: 'aud_004', timestamp: new Date(now - 3 * 86_400_000).toISOString(), admin: ADMIN_NAMES[2], action: 'model.disabled', targetType: 'model', targetId: 'gateway-large-preview', targetLabel: 'Gateway Large (preview)', before: 'enabled', after: 'disabled', reason: 'Provider not yet connected' },
    { id: 'aud_005', timestamp: new Date(now - 3 * 86_400_000 + 7_200_000).toISOString(), admin: ADMIN_NAMES[2], action: 'pricing.changed', targetType: 'model', targetId: 'sarvam-m', targetLabel: 'Sarvam-M (flagship)', before: '₹9.5 in / ₹26 out', after: '₹8 in / ₹24 out', reason: 'Aligned with simulated provider quote' },
    { id: 'aud_006', timestamp: new Date(now - 2 * 86_400_000).toISOString(), admin: ADMIN_NAMES[0], action: 'ratelimits.changed', targetType: 'platform', targetId: 'platform', targetLabel: 'Platform rate limits', before: '30 req/min per account', after: '20 req/min per account', reason: 'Volume spike mitigation' },
    { id: 'aud_007', timestamp: new Date(now - 2 * 86_400_000 + 5_400_000).toISOString(), admin: ADMIN_NAMES[1], action: 'account.activated', targetType: 'account', targetId: 'acc_026', targetLabel: 'Aditi Ghosh', before: 'restricted', after: 'active', reason: 'Manual review passed' },
    { id: 'aud_008', timestamp: new Date(now - 1 * 86_400_000).toISOString(), admin: ADMIN_NAMES[0], action: 'settings.updated', targetType: 'platform', targetId: 'settings', targetLabel: 'Admin settings', before: 'daily free credits: 400', after: 'daily free credits: 500', reason: 'Launch week allowance' },
    { id: 'aud_009', timestamp: new Date(now - 20 * 3_600_000).toISOString(), admin: 'system (scheduler)', action: 'reset.daily_triggered', targetType: 'platform', targetId: `reset:${addDaysToDayKey(todayKey, -1)}`, targetLabel: `Daily reset ${addDaysToDayKey(todayKey, -1)}`, before: null, after: `${accounts.length - 4} accounts reissued`, reason: 'Scheduled daily reset' },
    { id: 'aud_010', timestamp: new Date(now - 8 * 3_600_000).toISOString(), admin: ADMIN_NAMES[2], action: 'account.limits_changed', targetType: 'account', targetId: 'acc_004', targetLabel: 'Arjun Patel', before: 'daily 400', after: 'daily 180', reason: 'Trial account tighter allowance' },
    { id: 'aud_011', timestamp: new Date(now - 4 * 3_600_000).toISOString(), admin: ADMIN_NAMES[1], action: 'alert.resolved', targetType: 'alert', targetId: 'alr_006', targetLabel: 'Unusually high estimated API cost', before: 'open', after: 'resolved', reason: 'Confirmed batch job, not abuse' },
    { id: 'aud_012', timestamp: new Date(now - 1 * 3_600_000).toISOString(), admin: ADMIN_NAMES[0], action: 'credits.deducted', targetType: 'account', targetId: 'acc_017', targetLabel: 'Karan Bhatt', before: '1250 credits', after: '1100 credits', reason: 'Billing adjustment after review' },
  ]

  // --- Reset history ---------------------------------------------------------
  const resetHistory: ResetHistoryEntry[] = [1, 2, 3].map(daysAgo => ({
    id: `rst_${daysAgo}`, triggeredAt: new Date(istDayStartMs(addDaysToDayKey(todayKey, -daysAgo))).toISOString(),
    periodId: addDaysToDayKey(todayKey, -daysAgo), accountsAffected: accounts.filter(a => a.status === 'active' || a.status === 'restricted').length,
    creditsReissued: accounts.filter(a => a.status === 'active' || a.status === 'restricted').reduce((sum, a) => sum + a.limits.daily, 0),
    triggeredBy: 'system (scheduler, simulated)',
  }))

  const settings: AdminSettings = {
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
    creditRules: { ...CREDIT_RULES_SEED },
    costEstimation: { includeFailedRequests: true, markupPercent: 0 },
    resetPolicies: { dailyResetTime: '00:00', monthlyResetDay: 1, dailyCreditsExpire: true, permanentCarryOver: true, promoValidityDays: 30 },
    notifications: { creditThresholdPercent: 80, failedRequestThreshold: 5, dailyCostThresholdInr: 500, unusualConsumptionPercent: 200 },
  }

  const rateLimits: RateLimitConfig = {
    requestsPerMinute: 20, requestsPerHour: 300, requestsPerDay: 1200, maxConcurrentRequests: 3,
    maxInputTokensPerRequest: 8000, maxOutputTokensPerRequest: 4096, maxCreditsPerRequest: 120,
    globalRequestsPerMinute: 600, globalRequestsPerDay: 25000,
    modelRules: Object.fromEntries(MODELS.map(model => [model.id, { requestsPerDay: model.enabled ? 4000 : 0, maxOutputTokens: model.maxOutputTokens }])),
    roleRules: { user: { requestsPerDay: 600, dailyCredits: 500 }, pro: { requestsPerDay: 2000, dailyCredits: 1200 }, team: { requestsPerDay: 4000, dailyCredits: 3000 }, admin: { requestsPerDay: 10000, dailyCredits: 10000 } },
    accountOverrides: {
      acc_004: { requestsPerDay: 300, dailyCredits: 180, note: 'Trial account — tighter allowance' },
      acc_013: { requestsPerDay: 1500, dailyCredits: 200, note: 'Automation testing window' },
      acc_011: { requestsPerDay: 150, note: 'Restricted pending review' },
    },
  }

  return { now, accounts, requests, transactions, auditEvents, alerts, models: MODELS, providers: PROVIDERS, settings, rateLimits, resetHistory }
}

/** Audit action helper type re-exported for the store. */
export type { AuditAction, AlertSeverity }
