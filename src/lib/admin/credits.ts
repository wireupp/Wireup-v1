// Centralized credit and cost accounting. In the future these functions move
// behind authenticated server-side endpoints; the client must never be the
// authority for billing. All prices are SIMULATED demo configuration.

import type { CreditRules, ModelConfig } from './types'

const round2 = (value: number) => Math.round(value * 100) / 100

/** Platform credits consumed by a request, based on the global credit rules and the model multiplier. */
export function calculateCreditCharge(inputTokens: number, outputTokens: number, model: ModelConfig, rules: CreditRules): number {
  const base = (inputTokens / 1000) * rules.creditsPer1kInput + (outputTokens / 1000) * rules.creditsPer1kOutput
  return round2(base * model.creditMultiplier)
}

/** Estimated provider cost in INR using simulated per-million token prices. */
export function estimateApiCostInr(inputTokens: number, outputTokens: number, model: ModelConfig, markupPercent = 0): number {
  const raw = (inputTokens / 1_000_000) * model.inputPricePerMillion + (outputTokens / 1_000_000) * model.outputPricePerMillion
  return round2(raw * (1 + markupPercent / 100))
}

/** Effective credits allowed for a single request: min of the model cap and the account's per-request limit. */
export function effectivePerRequestCap(model: ModelConfig, accountPerRequestLimit: number): number {
  return Math.min(model.maxCreditsPerRequest, accountPerRequestLimit)
}

/** Apply a charge to the balance buckets (daily first, then promotional, then permanent). Returns the per-bucket spend. */
export function applyChargeToBuckets(balances: { daily: number; permanent: number; promotional: number }, amount: number): { daily: number; promotional: number; permanent: number } {
  let remaining = amount
  const fromDaily = Math.min(balances.daily, remaining)
  remaining -= fromDaily
  const fromPromo = Math.min(balances.promotional, remaining)
  remaining -= fromPromo
  const fromPermanent = Math.min(balances.permanent, remaining)
  return { daily: round2(fromDaily), promotional: round2(fromPromo), permanent: round2(fromPermanent) }
}
