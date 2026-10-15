/**
 * Shared harness for the mechanics and environment bench cases.
 *
 * A bench case is a claim about the platform, written as code that runs the real solver
 * through the real trial runner and then compares the recorded telemetry against a number
 * derived independently (a closed form, a hand calculation, or a second run). Nothing here
 * is a mock: if the solver stops working, every case in this directory fails.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { environmentSolver } from '../../packages/solvers/environment/solver.mjs';
import { mechanicsSolver } from '../../packages/solvers/mechanics/solver.mjs';
import { softwareSolver } from '../../packages/solvers/software/solver.mjs';
import { TelemetryBus } from '../../packages/core/telemetry/bus.mjs';
import { TelemetryRecorder } from '../../packages/core/telemetry/recorder.mjs';
import * as metrics from '../../packages/core/trials/metrics.mjs';
import { runProbes } from '../../packages/core/trials/probes.mjs';
import { runTrial } from '../../packages/core/trials/runner.mjs';

export const SOLVERS = { mechanicsSolver, environmentSolver, softwareSolver };

/**
 * Pick the solver that owns the graph's substantive node.
 *
 * A boat's first node is usually its water body, so "first node" is the wrong rule: the
 * environment solver does not simulate a hull, and the mechanics solver does not own
 * `env.*` even though it reads it.
 */
export function solverFor(graph, overrides = {}) {
  const kinds = graph.nodes.map((node) => node.kind);
  const pick = kinds.some((kind) => kind.startsWith('software.')) ? softwareSolver
    : kinds.some((kind) => kind.startsWith('mech.') || kind.startsWith('actuator.')) ? mechanicsSolver
      : environmentSolver;
  return { ...pick, ...overrides };
}

/** Build the trial services the runner requires, around one solver. */
export async function makeServices(solver, { root, seed = 1, clock = Date, channelName = null } = {}) {
  const recorder = new TelemetryRecorder({ root });
  const telemetry = new TelemetryBus({ capacity: 1_000_000 });
  const opened = [];
  return {
    recorder,
    telemetry,
    clock,
    repeats: 1,
    opened,
    async solve(graph, { seed: runSeed, signal }) {
      const context = {
        graph,
        seed: runSeed,
        signal,
        project_id: graph.project_id,
        runProbes,
        clock,
        emit() {},
        log() {},
      };
      const plan = await solver.prepare(graph, context);
      // Disposal happens when the whole run is over, NOT here: a solver's telemetry stream is
      // lazy, so disposing the plan the moment run() returns would tear the world down before
      // the first sample is read.
      opened.push(plan);
      return solver.run(plan, context);
    },
    computeMetric(name, series, window) {
      const scopedSeries = channelName
        ? series.filter((entry) => entry.channel === channelName)
        : series;
      const flat = scopedSeries.flatMap((entry) => entry.samples)
        .filter((sample) => sample.quality === 'measured');
      if (!flat.length) return { value: null, insufficient: true };
      const scoped = window ? flat.filter((sample) => sample.t >= window[0] && sample.t <= window[1]) : flat;
      if (name === 'count') return { value: scoped.length, insufficient: false };
      const fn = metrics[name];
      if (typeof fn !== 'function') {
        throw Object.assign(new Error(`Unknown metric '${name}'.`), { code: 'UNKNOWN_METRIC' });
      }
      return fn(scoped);
    },
  };
}

/** Run one trial and return the whole result plus a flat list of measured samples. */
export async function runCase(graph, goal, {
  parameters = [], envOverrides = {}, seed = 1, solver = null, channelName = null,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wireup-bench-'));
  try {
    const chosen = solver ?? solverFor(graph);
    const services = await makeServices(chosen, { root, seed, channelName });
    const result = await runTrial(graph, goal, parameters, envOverrides, seed, services);
    const series = services.telemetry.query({ projectId: graph.project_id });
    for (const plan of services.opened) await chosen.dispose(plan);
    return { result, series, root };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/** Samples for one channel across the series the run produced. */
export function channel(series, name, { quality = 'measured' } = {}) {
  return series.filter((entry) => entry.channel === name).flatMap((entry) => entry.samples)
    .filter((sample) => quality === null || sample.quality === quality)
    .sort((a, b) => a.t - b.t);
}

/** Assert helper that reads like the assertion it is checking. */
export function within(actual, expected, fraction, label) {
  const tolerance = Math.abs(expected) * fraction;
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) {
    throw new Error(
      `${label}: got ${actual}, expected ${expected} +/- ${tolerance} (${fraction * 100}% of ${expected})`,
    );
  }
  return ok;
}

export function assertWithin(actual, expected, fraction, label) {
  if (!within(actual, expected, fraction, label)) throw new Error('unreachable');
}

export async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}