/**
 * Budgets, phase v09.
 *
 * Every budget is enforced here and nowhere else, so "we ran out" has exactly one meaning in the
 * code. Exhaustion is reported AS exhaustion — never as a confident summary of work that did not
 * finish. `max_model_calls` counts real calls to the configured provider; a run with no provider
 * configured spends zero, and that is a fact about the run rather than an assumption about it.
 */

export const DEFAULT_BUDGET = Object.freeze({
  max_iterations: 12,
  max_tool_calls: 400,
  max_model_calls: 60,
  max_seconds: 1800,
  // Zero by default: the run refuses to spend money nobody authorised. A non-zero value must be
  // supplied by the caller, in the provider's own currency.
  max_spend_usd: 0,
});

export class BudgetExhausted extends Error {
  constructor(budget, used, limit) {
    super(`Budget '${budget}' exhausted: ${used} of ${limit}.`);
    this.name = 'BudgetExhausted';
    this.code = 'BUDGET_EXHAUSTED';
    this.budget = budget;
    this.used = used;
    this.limit = limit;
  }
}

export class Budget {
  constructor({ limits = {}, clock = { now: () => Date.now() }, costOfModelCall = 0 } = {}) {
    this.limits = { ...DEFAULT_BUDGET, ...limits };
    this.clock = clock;
    this.costOfModelCall = costOfModelCall;
    this.startedAt = clock.now();
    this.used = { iterations: 0, tool_calls: 0, model_calls: 0, seconds: 0, spend_usd: 0 };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(`Budget '${name}' must be a non-negative number.`);
      }
    }
  }

  /** @returns {string|null} the exhausted budget name, or null */
  check() {
    this.used.seconds = Math.max(0, (this.clock.now() - this.startedAt) / 1000);
    for (const name of ['iterations', 'tool_calls', 'model_calls', 'seconds', 'spend_usd']) {
      const limit = this.limits[`max_${name}`];
      // `max_spend_usd: 0` means "spend nothing", not "you have already spent your whole zero
      // budget". A limit of zero therefore only bites once something is actually spent.
      if (this.used[name] > limit || (limit > 0 && this.used[name] >= limit)) return name;
    }
    return null;
  }

  /**
 * Spending the last unit is legal; spending past the limit is not.
 *
 * `check()` answers "should the loop stop before starting another unit?" and therefore treats
 * `used >= limit` as exhausted. `assert()` answers "may this unit be spent?" and therefore only
 * trips on `used > limit`. Conflating the two makes `max_iterations: 1` mean zero iterations,
 * which is off by one in the direction that makes the bound a lie.
 */
assert(name) {
  this.check();
  const limit = this.limits[`max_${name}`];
  if (this.used[name] > limit) {
    throw new BudgetExhausted(name, this.used[name], limit);
  }
}

  spendIteration() {
    this.used.iterations += 1;
    this.assert('iterations');
  }

  spendToolCall() {
    this.used.tool_calls += 1;
    this.assert('tool_calls');
  }

  spendModelCall() {
    this.used.model_calls += 1;
    this.used.spend_usd += this.costOfModelCall;
    this.assert('model_calls');
    this.assert('spend_usd');
  }

  remaining() {
    return {
      iterations: Math.max(0, this.limits.max_iterations - this.used.iterations),
      tool_calls: Math.max(0, this.limits.max_tool_calls - this.used.tool_calls),
      model_calls: Math.max(0, this.limits.max_model_calls - this.used.model_calls),
      seconds: Math.max(0, this.limits.max_seconds - this.used.seconds),
      spend_usd: Math.max(0, this.limits.max_spend_usd - this.used.spend_usd),
    };
  }

  report() {
    this.check();
    return { limits: { ...this.limits }, used: { ...this.used }, remaining: this.remaining() };
  }
}