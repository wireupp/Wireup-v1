import { SolverUnavailable } from './protocol.mjs';

function reportRows(report) {
  if (Array.isArray(report?.rows)) return report.rows;
  if (Array.isArray(report?.results)) return report.results;
  return [];
}

function reportTimestamp(report) {
  const value = report?.generated_at ?? report?.timestamp ?? report?.completed_at;
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function passingTestIds(report) {
  const grouped = new Map();
  for (const row of reportRows(report)) {
    if (typeof row.id !== 'string') continue;
    if (!grouped.has(row.id)) grouped.set(row.id, []);
    grouped.get(row.id).push(row.status);
  }
  return new Set([...grouped].filter(([, statuses]) =>
    statuses.length > 0 && statuses.every((status) => status === 'pass')).map(([id]) => id));
}

export async function verifySolver(solver, { testReport = {}, now = Date.now() } = {}) {
  const manifest = solver.manifest;
  const failedTests = manifest.verification.tests.filter((testId) =>
    !passingTestIds(testReport).has(testId));
  let selfTestPassed = false;
  let selfTestError = null;

  try {
    if (typeof solver.selfTest !== 'function') throw new Error('Solver has no selfTest().');
    selfTestPassed = await solver.selfTest();
  } catch (error) {
    selfTestError = error instanceof Error ? error.message : String(error);
  }

  const verifiedAt = reportTimestamp(testReport);
  const fresh = verifiedAt !== null && now >= verifiedAt && now - verifiedAt <= 90 * 24 * 60 * 60 * 1000;
  const confidence = !selfTestPassed
    ? 'experimental'
    : manifest.verification.tests.length > 0 && failedTests.length === 0 && fresh
      ? 'verified'
      : 'partial';

  return {
    confidence,
    self_test_passed: selfTestPassed,
    self_test_error: selfTestError,
    failed_tests: failedTests,
    verified_at: verifiedAt === null ? null : new Date(verifiedAt).toISOString(),
  };
}

export async function selfTestRegistry(registry, options = {}) {
  const results = new Map();
  for (const solver of registry.list()) {
    const base = await verifySolver(solver, options);
    if (!base.self_test_passed) {
      results.set(solver.manifest.id, base);
      continue;
    }

    const failures = [];
    for (const kindId of solver.manifest.kindIds) {
      const controller = new AbortController();
      const context = {
        graph: { nodes: [{ id: 'solver_self_test', kind: kindId }], edges: [] },
        seed: 0,
        deadlineMs: Date.now() + 1000,
        signal: controller.signal,
        emit() {},
        services: {},
        log() {},
      };
      try {
        await solver.prepare(context.graph, context);
      } catch (error) {
        failures.push({ kind: kindId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    results.set(solver.manifest.id, {
      ...base,
      confidence: failures.length ? 'experimental' : base.confidence,
      self_test_passed: failures.length === 0,
      self_test_error: failures.length ? JSON.stringify(failures) : base.self_test_error,
    });
  }
  return results;
}

export function requireSolverFeature(solver, feature) {
  const unavailable = solver.manifest.unavailable.find((entry) => entry.feature === feature);
  if (unavailable) {
    throw new SolverUnavailable(unavailable.feature, unavailable.reason, unavailable.requiredToSupport);
  }
}
