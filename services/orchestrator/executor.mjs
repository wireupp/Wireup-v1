/**
 * The experiment loop, phase v09.
 *
 * ```
 * for iteration in 1..max_iterations:
 *   1. read the project
 *   2. decide the next experiment (one parameter change, or a structural fix)
 *   3. mutate through the tool bus            (invariant I1: the only mutation path)
 *   4. run the trial                           (packages/core/trials)
 *   5. judge it                                (services/orchestrator/verdict)
 *   6. pass -> stop; error -> classify; unclassified -> stop and report
 * ```
 *
 * Every budget is checked at the TOP of the iteration, so an exhausted budget ends the run
 * before another expensive step is begun rather than after it. There are no blind retries:
 * `classify()` maps an error code to exactly one action, and anything unclassified stops the run.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphStore } from '../../packages/core/graph/store.mjs';
import { ToolBus, createRegistry, createStubServices } from '../../packages/toolbus/index.mjs';
import { TelemetryBus } from '../../packages/core/telemetry/bus.mjs';
import { TelemetryRecorder } from '../../packages/core/telemetry/recorder.mjs';
import * as metrics from '../../packages/core/trials/metrics.mjs';
import { runProbes } from '../../packages/core/trials/probes.mjs';
import { runTrial } from '../../packages/core/trials/runner.mjs';
import { environmentSolver } from '../../packages/solvers/environment/solver.mjs';
import { mechanicsSolver } from '../../packages/solvers/mechanics/solver.mjs';
import { softwareSolver } from '../../packages/solvers/software/solver.mjs';
import { judgeAll } from './verdict.mjs';
import { GoalNotMeasurable } from './goal.mjs';

const SOLVERS = {
  mechanics: mechanicsSolver,
  software: softwareSolver,
  environment: environmentSolver,
};

/**
 * Error classification.
 *
 * One code, one action. Anything not listed stops the run: a loop that retries an unknown
 * failure is a loop that hides bugs.
 */
export const ACTIONS = Object.freeze({
  REVISION_STALE: 're-read and retry',
  TOOL_ERROR_INVALID_ARGS: 'repair the plan and stop',
  SOLVER_UNAVAILABLE: 'report infeasible and stop',
  GOAL_NOT_MEASURABLE: 'report unverified and stop',
  BUDGET_EXHAUSTED: 'report partial progress and stop',
  TIMEOUT: 'reduce the simulation horizon and retry',
  RECORDING_TRUNCATED: 'report unverified and stop',
  PROVIDER_ERROR: 'report unverified and stop',
});

export function classify(code) {
  return { action: ACTIONS[code] ?? null, known: Object.hasOwn(ACTIONS, code ?? '') };
}

/**
 * Execute one plan.
 *
 * @param {object} input
 * @param {object} input.goal ParsedGoal
 * @param {object} input.plan
 * @param {import('./budget.mjs').Budget} input.budget
 * @param {function} input.emit event sink
 * @param {number} input.seed
 * @param {function} [input.provider] async (request) => string; a model call, counted by budget
 */
export async function execute({ goal, plan, budget, emit, seed = 1, provider = null }) {
  const projectId = goal.project_id ?? 'orchestrator';
  const store = new GraphStore({
    schema_version: 3,
    id: projectId,
    domain: goal.domain,
    revision: 0,
    created_at: new Date(budget.clock.now()).toISOString(),
    updated_at: new Date(budget.clock.now()).toISOString(),
    nodes: [],
    edges: [],
  });
  const bus = await createBus(store, projectId, budget, emit);

  if (plan.infeasible) {
    emit({ type: 'plan.rejected', reason: plan.infeasible.reason, required_to_support: plan.infeasible.required_to_support });
    // H1: an infeasible plan executes ZERO mutations. That is the point of the "says no" path.
    return { store, projectId, verdicts: [], iterations: 0, lastTrial: null, infeasible: plan.infeasible };
  }

  const parameters = plan.trial_design.parameters;
  let verdicts = [];
  let lastTrial = null;
  let iterations = 0;
  let stopped = null;

  while (iterations < budget.limits.max_iterations) {
    const exhausted = budget.check();
    if (exhausted) {
      emit({ type: 'budget.exhausted', budget: exhausted, used: budget.used[exhausted], limit: budget.limits[`max_${exhausted}`] });
      stopped = { code: 'BUDGET_EXHAUSTED', detail: `budget '${exhausted}' exhausted` };
      break;
    }
    try {
      budget.spendIteration();
    } catch (error) {
      // Spending the LAST unit is not a crash: it is the run finishing on its bound. The
      // work already done is reported as partial progress.
      emit({
        type: 'budget.exhausted',
        budget: error.budget ?? 'unknown',
        used: error.used ?? null,
        limit: error.limit ?? null,
      });
      stopped = { code: 'BUDGET_EXHAUSTED', detail: error.message, action: 'report partial progress and stop' };
      break;
    }
    iterations += 1;
    emit({ type: 'iteration.started', iteration: iterations });

    try {
      // 1-2. Build the plan into the project, one tool call per node, through the tool bus.
      //      The tool bus returns an envelope, never a throw: a rejected mutation must stop the
      //      run with a named code, not blow up the loop.
      if (store.read().nodes.length === 0) {
        for (const step of plan.build_steps) {
          budget.assert('tool_calls');
          const node = plan.skeleton.nodes.find((entry) => entry.id === step.args_summary.split(' ')[1]);
          if (!node) continue;
          spendToolCall(budget);
          const outcome = await bus.invoke('node.add', {
            node: structuredClone(node),
            expected_revision: store.read().revision,
          }, context(store, projectId, budget, emit));
          if (!outcome.ok) throw toolError('TOOL_ERROR_INVALID_ARGS', outcome.error);
          emit({ type: 'mutation.applied', operation: 'node.add', node: node.id, revision: store.read().revision });
        }
        for (const edge of plan.skeleton.edges) {
          spendToolCall(budget);
          const outcome = await bus.invoke('edge.connect', {
            edge: structuredClone(edge),
            expected_revision: store.read().revision,
          }, context(store, projectId, budget, emit));
          if (!outcome.ok) throw toolError('TOOL_ERROR_INVALID_ARGS', outcome.error);
          emit({ type: 'mutation.applied', operation: 'edge.connect', edge: edge.id, revision: store.read().revision });
        }
      } else if (parameters.length) {
        // 2. One parameter change per iteration: the experiment is the variable.
        const index = Math.min(iterations - 2, parameters[0].values.length - 1);
        const value = parameters[0].values[index];
        spendToolCall(budget);
        const outcome = await bus.invoke('node.modify', {
          node_id: parameters[0].node,
          patch: { properties: { [parameters[0].property]: value } },
          expected_revision: store.read().revision,
        }, context(store, projectId, budget, emit));
        if (!outcome.ok) throw toolError('TOOL_ERROR_INVALID_ARGS', outcome.error);
        emit({ type: 'mutation.applied', operation: 'node.modify', node: parameters[0].node, value });
      }

      // 3. If a provider is configured, the firmware seat is a model call — counted, bounded,
      //    and its failure stops the run rather than being papered over.
      if (provider) {
        budget.spendModelCall();
        const authored = await provider({ goal: goal.raw, channel: goal.metrics[0].channel });
        if (typeof authored !== 'string' || !authored.length) {
          throw Object.assign(new Error('The configured provider returned no usable content.'), {
            code: 'PROVIDER_ERROR',
          });
        }
        emit({ type: 'compile.result', source_length: authored.length });
      }

      // 4. Run the trial. This is the headless lane: no browser, no chat client.
      const trial = await runHeadlessTrial({ graph: store.read(), goal, seed: seed + iterations, budget });
      lastTrial = trial;
      emit({ type: 'run.result', verdict: trial.result.verdict, trial_id: trial.trialId });
      emit({ type: 'trial.result', summary: trial.result.summary });

      // 5. Judge.
      verdicts = judgeAll(goal, {
        series: trial.series,
        trialId: trial.trialId,
        recording: trial.trialId,
        window: goal.metrics[0].window,
      });
      for (const verdict of verdicts) {
        emit({
          type: 'verdict',
          channel: verdict.channel,
          measured: verdict.measured,
          target: verdict.target,
          pass: verdict.pass,
          reason: verdict.reason,
          quality: verdict.quality,
        });
      }
      if (verdicts.every((verdict) => verdict.pass && verdict.quality === 'measured')) break;

      const failure = classify(trial.result.verdict === 'error'
        ? trial.result.runs.at(-1)?.error?.code ?? 'SOLVER_FAILED'
        : null);
      if (trial.result.verdict === 'error' && failure.known === false && trial.result.runs.at(-1)?.error?.code) {
        stopped = { code: trial.result.runs.at(-1).error.code, detail: 'unclassified solver failure' };
        emit({ type: 'blocked', code: stopped.code });
        break;
      }
    } catch (error) {
      const decision = classify(error?.code);
      emit({ type: 'blocked', code: error?.code ?? 'ERROR', action: decision.action, detail: error?.message ?? String(error) });
      stopped = {
        code: error?.budget_exhausted ? 'BUDGET_EXHAUSTED' : (error?.code ?? 'ERROR'),
        detail: error?.message ?? String(error),
        action: decision.action ?? (error?.budget_exhausted ? 'report partial progress and stop' : 'stop'),
      };
      if (error?.budget_exhausted) {
        emit({ type: 'budget.exhausted', budget: error.budget ?? 'tool_calls', used: error.used ?? null, limit: error.limit ?? null });
      }
      break;
    }
  }

  return { store, projectId, verdicts, iterations, lastTrial, infeasible: null, stopped };
}

/** One headless trial through the real solver and the real trial runner. */
async function runHeadlessTrial({ graph, goal, seed, budget }) {
  const plan = { lane: LANE_BY_DOMAIN[goal.domain === 'hybrid' ? 'mechanics' : goal.domain] };
  const solver = SOLVERS[plan.lane];
  if (!solver) {
    throw Object.assign(new Error(`No headless solver is registered for lane '${plan.lane}'.`), {
      code: 'SOLVER_UNAVAILABLE',
    });
  }
  const root = await mkdtemp(join(tmpdir(), 'wireup-orchestrator-'));
  const recorder = new TelemetryRecorder({ root });
  const telemetry = new TelemetryBus({ capacity: 1_000_000 });
  const clock = budget.clock;
  const metric = goal.metrics[0];
  const services = {
    recorder,
    telemetry,
    clock,
    repeats: 1,
    id: () => `orchestrator-${seed}`,
    async solve(solved, { seed: runSeed, signal }) {
      const runContext = {
        graph: solved,
        seed: runSeed,
        signal,
        project_id: solved.project_id,
        runProbes,
        clock,
        emit() {},
        log() {},
      };
      const prepared = await solver.prepare(solved, runContext);
      return solver.run(prepared, runContext);
    },
    computeMetric(name, series) {
      const flat = series.filter((entry) => entry.channel === metric.channel)
        .flatMap((entry) => entry.samples)
        .filter((sample) => sample.quality === 'measured');
      if (!flat.length) return { value: null, samples: 0, insufficient: true };
      const fn = metrics[name] ?? metrics.mean;
      return fn(flat);
    },
  };
  const result = await runTrial(graph, {
    metric: metric.metric,
    direction: 'target',
    target: 0,
    tolerance: Number.MAX_SAFE_INTEGER,
  }, [], {}, seed, services);
  return {
    result,
    trialId: result.id,
    series: telemetry.query({ projectId: graph.project_id ?? graph.id }),
    root,
  };
}

const LANE_BY_DOMAIN = { mechanics: 'mechanics', software: 'software', electronics: null };

async function createBus(store, projectId, budget, emit) {
  const services = createStubServices({
    clock: budget.clock,
    // Nothing in the headless lane uses persistence, catalog or a browser runtime. The stubs
    // refuse loudly if something ever tries, which is the correct behaviour for an
    // orchestrator that must not silently depend on a browser.
  });
  const registry = await createRegistry({ services });
  return new ToolBus({ registry, services, rateLimit: Number.MAX_SAFE_INTEGER });
}

function spendToolCall(budget) {
  try {
    budget.spendToolCall();
  } catch (error) {
    // As with iterations, hitting the tool-call bound ends the run cleanly.
    throw Object.assign(error, { budget_exhausted: true });
  }
}

function toolError(code, error) {
  const mapped = error?.code === 'REVISION_STALE' ? 'REVISION_STALE'
    : error?.code === 'INVALID_ARGUMENTS' ? 'TOOL_ERROR_INVALID_ARGS' : code;
  return Object.assign(new Error(`${mapped}: ${error?.message ?? 'tool call failed'}`), {
    code: mapped,
    retryable: Boolean(error?.retryable),
  });
}

function context(store, projectId, budget, emit) {
  return {
    store,
    projectId,
    actor: 'orchestrator',
    clock: budget.clock,
    emit: (event) => emit(event),
  };
}

export { GoalNotMeasurable };