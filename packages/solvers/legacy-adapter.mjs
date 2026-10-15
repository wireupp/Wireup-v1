import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SolverUnavailable, validateManifest } from './protocol.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const KINDS = JSON.parse(readFileSync(resolve(ROOT, 'contracts/kinds.json'), 'utf8')).kinds;

export function legacyBrowserSolver({ id, version, scopes, analyses = [], targets, limits, tests, knownFailures, unavailable }) {
  const kindIds = KINDS
    .filter((kind) => kind.simulated && kind.solver === id && scopes.includes(kind.scope))
    .map((kind) => kind.id)
    .sort();
  const manifest = validateManifest({
    id,
    version,
    kindIds,
    telemetryChannels: [],
    analyses,
    ...(targets ? { targets } : {}),
    limits,
    verification: { tests },
    knownFailures,
    unavailable,
  });
  const disposed = new WeakSet();

  return {
    manifest,
    async selfTest() {
      if (!kindIds.length) return false;
      return kindIds.every((kindId) => {
        const kind = KINDS.find((entry) => entry.id === kindId);
        return kind?.evidence?.length > 0
          && kind.evidence.every((path) => existsSync(resolve(ROOT, path)));
      });
    },
    async prepare(graph, context) {
      const nodes = graph?.nodes;
      if (!Array.isArray(nodes)) throw new TypeError('Solver graph must contain nodes.');
      const unsupported = nodes.find((node) => !kindIds.includes(node.kind));
      if (unsupported) {
        const refusal = unavailable.find((entry) => entry.kind === unsupported.kind)
          ?? { feature: unsupported.kind, reason: `${id} does not simulate '${unsupported.kind}'.`, requiredToSupport: 'A tested solver implementation for this kind.' };
        throw new SolverUnavailable(refusal.feature, refusal.reason, refusal.requiredToSupport);
      }
      const requested = graph.analysis ?? graph.metadata?.analysis;
      if (requested === 'ac' && !analyses.includes('ac')) {
        const refusal = unavailable.find((entry) => entry.feature === 'ac sweep');
        if (refusal) throw new SolverUnavailable(refusal.feature, refusal.reason, refusal.requiredToSupport);
      }
      return { solver: id, graph, adapter: context.services?.[id] ?? null };
    },
    async run(plan, context) {
      if (context.signal?.aborted) throw context.signal.reason ?? new Error('Solver run aborted.');
      const service = context.services?.[id];
      if (typeof service?.run !== 'function') {
        throw new SolverUnavailable(id, `${id} legacy browser engine is not available in this runtime.`, 'An injected, tested solver runtime.');
      }
      return service.run(plan, context);
    },
    async dispose(plan) {
      if (plan && typeof plan === 'object' && disposed.has(plan)) return;
      if (plan && typeof plan === 'object') disposed.add(plan);
      if (plan?.adapter && typeof plan.adapter.dispose === 'function') {
        await plan.adapter.dispose(plan);
      }
    },
  };
}

export function declaredUnavailableSolver({ id, version, unavailable }) {
  const manifest = validateManifest({
    id,
    version,
    kindIds: [],
    telemetryChannels: [],
    analyses: [],
    limits: {},
    verification: { tests: [] },
    knownFailures: [],
    unavailable,
  });
  return {
    manifest,
    async selfTest() { return false; },
    async prepare(_graph, _context) {
      const entry = unavailable[0];
      throw new SolverUnavailable(entry.feature, entry.reason, entry.requiredToSupport);
    },
    async run() {
      const entry = unavailable[0];
      throw new SolverUnavailable(entry.feature, entry.reason, entry.requiredToSupport);
    },
    async dispose() {},
  };
}
