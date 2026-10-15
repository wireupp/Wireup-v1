/**
 * The orchestrator entry point, phase v09.
 *
 * `runOrchestrator` takes a goal in plain language and returns a `BuildReport`, emitting a
 * stream of structured events along the way. There is NO narration and NO chat client: the
 * event feed is a checklist, not a conversation.
 *
 * The loop is deterministic. A model, if one is configured, may author firmware and is counted
 * against `max_model_calls`; it never decides what to build. When no provider is configured the
 * run spends zero model calls and says so in the report rather than implying one happened.
 */

import { rm } from 'node:fs/promises';
import { readCapability } from '../../packages/solvers/capability.mjs';
import { Budget } from './budget.mjs';
import { execute } from './executor.mjs';
import { GoalNotMeasurable, parseGoal } from './goal.mjs';
import { planGoal } from './planner.mjs';
import { buildReport } from './report.mjs';
import { statusFor } from './verdict.mjs';

/**
 * @param {string} goalText
 * @param {object} [options]
 * @param {object} [options.budget] budget limits; merged over the defaults
 * @param {object} [options.clock]
 * @param {function} [options.onEvent]
 * @param {function} [options.provider] async ({goal, channel}) => string
 * @param {number} [options.seed]
 * @param {string} [options.project_id]
 * @returns {Promise<{report: object, events: object[]}>}
 */
export async function runOrchestrator(goalText, options = {}) {
  const events = [];
  const emit = (event) => {
    events.push(event);
    options.onEvent?.(event);
  };
  const clock = options.clock ?? { now: () => Date.now() };
  const budget = new Budget({ limits: options.budget, clock, costOfModelCall: options.costOfModelCall ?? 0 });
  const capability = options.capability ?? readCapability();

  let goal;
  try {
    goal = parseGoal(goalText);
  } catch (error) {
    if (error instanceof GoalNotMeasurable) {
      emit({ type: 'blocked', code: error.code, suggestion: error.suggestion });
      return {
        report: refusedReport(goalText, error, capability, budget),
        events,
      };
    }
    throw error;
  }
  goal.project_id = options.project_id ?? '00000000000000000000000000000000';
  emit({ type: 'goal.parsed', domain: goal.domain, metrics: goal.metrics.length, assumptions: goal.ambiguities.length });

  const plan = planGoal(goal, capability);
  emit({
    type: plan.infeasible ? 'plan.rejected' : 'plan.created',
    domain: plan.domain,
    lane: plan.lane,
    kinds: plan.required_kinds.map((entry) => entry.kind),
    risks: plan.risks.length,
    ...(plan.infeasible ? { reason: plan.infeasible.reason, required_to_support: plan.infeasible.required_to_support } : {}),
  });

  const outcome = await execute({
    goal,
    plan,
    budget,
    emit,
    seed: options.seed ?? 1,
    provider: options.provider ?? null,
  });

  try {
    await cleanup(outcome.lastTrial?.root);
  } catch {
    // A leftover scratch directory is not worth failing a run over, and it is under the OS
    // temp root. The recording itself was already verified by the trial runner.
  }

  const status = statusFor(outcome.verdicts, { infeasible: outcome.infeasible });
  const graph = outcome.store.read();
  const report = buildReport({
    goal,
    status,
    graph,
    revision: graph.revision,
    verdicts: outcome.verdicts,
    risks: plan.risks,
    infeasible: outcome.infeasible ?? plan.infeasible ?? null,
    budget: budget.report(),
    artifacts: [{ kind: 'telemetry', trial_id: outcome.lastTrial?.trialId ?? null }],
    iterations: outcome.iterations,
    blocked: outcome.stopped ?? null,
  });
  emit({ type: 'report.ready', status });
  return { report, events };
}

async function cleanup(root) {
  if (root) await rm(root, { recursive: true, force: true });
}

function refusedReport(goalText, error, capability, budget) {
  return {
    goal: {
      raw: String(goalText ?? ''),
      domain: 'electronics',
      deliverables: [],
      metrics: [],
      constraints: {},
      ambiguities: [{
        question: 'What should be measured?',
        assumption: 'Nothing: the goal contains no measurable quantity.',
        why: 'A goal the platform cannot check is a goal it can only appear to have met.',
        confidence: 0,
      }],
    },
    status: 'unverified',
    project_id: '00000000000000000000000000000000',
    graph_revision: 0,
    bom: [],
    bom_total: {
      amount: null,
      currency: null,
      priced_items: 0,
      unpriced_items: 0,
      price_source: null,
      as_of: null,
      note: 'No build list: nothing was built.',
    },
    wiring: [],
    assembly: [],
    firmware: { filename: null, language: null, source: null, upload_steps: [] },
    verification: [],
    assumptions: [],
    unmet: [{
      requirement: 'The goal states a quantity that can be measured.',
      reason: `${error.message} ${error.suggestion ?? ''}`.trim(),
      required_to_support: `Measure one of the ${capability.telemetry_channels?.length ?? 0} declared telemetry channels.`,
    }],
    confidence: { score: 0, basis: [{ score: 0, why: 'The run refused before building anything.' }] },
    artifacts: [],
    budget: budget.report(),
    iterations: 0,
  };
}

export { Budget, GoalNotMeasurable, parseGoal, planGoal, buildReport, statusFor };
export { renderReport } from './report.mjs';