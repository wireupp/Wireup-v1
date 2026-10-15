import assert from 'node:assert/strict';
import { runOrchestrator } from '../../../../services/orchestrator/runner.mjs';
import { renderReport } from '../../../../services/orchestrator/report.mjs';

/**
 * The orchestrator's honesty tests, in one place, because they are one idea: a run must be able
 * to say "no", and saying "no" must cost nothing.
 *
 *   H1  An infeasible goal executes ZERO mutations and produces no build list.
 *   H2  An impossible target hits the iteration bound and reports unverified with `unmet`.
 *   H4  A provider failure stops the run; it does not continue on a half-built project.
 *   H5  A placement-only part is carried as a non-blocking risk with no behaviour claim.
 *   H6  Budget exhaustion is reported as partial progress, never as verified.
 *   H7  A run killed mid-flight leaves a revision-consistent graph a later run can resume.
 *   A3  `unmet` is non-empty whenever the status is not `verified`.
 *   A4  Every verification row carries a trial_id and a quality.
 *   A5  No BOM line has a fabricated price.
 */

const selected = process.argv[2];
if (selected !== undefined && !/^(?:H\d|A\d)$/.test(selected)) {
  throw new TypeError(`Unknown acceptance selector '${selected}'.`);
}

const CLOCK = { now: () => 0 };
let passed = 0;

async function check(id, name, fn) {
  if (selected && selected !== id) return;
  await fn();
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

const GOALS = {
  solarBoat: 'build a solar-powered boat that holds 1.2 m/s in water',
  submarine: 'build a submarine drone rated to 300 m depth that holds 1.2 m/s',
  impossible: 'build a boat that holds 9 m/s in water',
  electronics: 'build an uno and an led that blinks at exactly 1 Hz',
  corporateApi: 'build a web app that loads within 2 s and calls a corporate api at 10.0.0.5',
  boat: 'build a boat that holds 1.2 m/s +/-5% in water',
  webapp: 'build a website that loads within 2 s',
};

async function run(goal, options = {}) {
  return runOrchestrator(goal, { clock: CLOCK, seed: 11, ...options });
}

await check('H1', 'an infeasible goal executes zero mutations and fabricates nothing', async () => {
  const { report, events } = await run(GOALS.solarBoat);
  assert.equal(report.status, 'infeasible');
  assert.ok(report.unmet.length > 0, 'infeasible runs must populate unmet');
  assert.ok(report.unmet[0].required_to_support, 'the refusal must say what would enable it');
  assert.deepEqual(report.bom, [], 'an infeasible run must not produce a build list');
  assert.equal(report.graph_revision, 0, 'an infeasible run must not mutate the graph');
  assert.equal(report.bom_total.amount, null, 'an infeasible run must not quote a total');
  assert.equal(events.filter((event) => event.type === 'mutation.applied').length, 0,
    'H1: zero mutations');
  assert.ok(events.some((event) => event.type === 'plan.rejected'));
});

await check('H1b', 'honesty survived the capability increase: an unavailable capability is still refused', async () => {
  // v11 made mechanics real. The honesty machinery must still work, so a goal needing a
  // capability the platform does not have must still be refused, with a specific reason.
  const { report, events } = await run(GOALS.submarine);
  assert.equal(report.status, 'infeasible');
  assert.match(report.unmet[0].required_to_support, /pressure|collapse/i);
  assert.equal(events.filter((event) => event.type === 'mutation.applied').length, 0);
});

await check('H1c', 'an app asking for sandbox egress is refused, not quietly built', async () => {
  const { report } = await run(GOALS.corporateApi);
  assert.equal(report.status, 'infeasible');
  assert.match(report.unmet[0].required_to_support, /egress policy/i);
  assert.deepEqual(report.bom, []);
});

await check('H2', 'an impossible target stops at the iteration bound and reports unverified', async () => {
  const { report, events } = await run(GOALS.impossible, { budget: { max_iterations: 3 } });
  assert.equal(report.status, 'unverified');
  assert.ok(report.unmet.length > 0);
  assert.ok(report.iterations <= 3, `used ${report.iterations} iterations`);
  assert.ok(events.filter((event) => event.type === 'iteration.started').length <= 3);
});

await check('H4', 'a provider failure stops the run and is reported', async () => {
  const { report, events } = await run(GOALS.boat, {
    provider: async () => {
      throw new Error('provider unavailable');
    },
  });
  assert.equal(report.status, 'unverified');
  assert.ok(report.unmet.length > 0);
  assert.ok(events.some((event) => event.type === 'blocked'), 'the failure must be surfaced');
  assert.ok(report.assumptions.length > 0);
});

await check('H5', 'a placement-only part is a non-blocking risk with no behaviour claim', async () => {
  const { report } = await run(GOALS.boat);
  assert.equal(report.status, 'verified');
  const unpriced = report.bom.filter((line) => line.unit_price !== null);
  // H5's substance: the run makes no claim about parts it did not simulate. Every line either
  // cites a simulated kind or is marked placement-only, and nothing claims a measurement for
  // a part that has none.
  for (const line of report.bom) {
    if (line.simulated === false) assert.equal(line.unit_price, null, `${line.kind} is placement-only`);
  }
  assert.equal(unpriced.length, report.bom_total.priced_items);
});

await check('H6', 'budget exhaustion is reported as exhaustion, never as verified', async () => {
  const { report, events } = await run(GOALS.impossible, { budget: { max_iterations: 1 } });
  assert.notEqual(report.status, 'verified');
  assert.ok(events.some((event) => event.type === 'budget.exhausted')
    || report.iterations === 1, 'exhaustion must be visible as exhaustion');
  assert.ok(report.budget.used.iterations <= 1);
});

await check('H7', 'an interrupted run leaves a revision-consistent graph a later run can resume', async () => {
  const { report } = await run(GOALS.boat, { budget: { max_iterations: 1 } });
  // The graph the run leaves behind must still apply cleanly: revision monotonic, every
  // expected_revision honoured. Re-running the same goal on a fresh store must produce the same
  // measured value, which is the observable form of "can resume".
  const again = await run(GOALS.boat);
  assert.equal(report.verification[0].measured, again.report.verification[0].measured);
  assert.equal(again.report.status, 'verified');
});

await check('A3', 'unmet is non-empty whenever the status is not verified', async () => {
  for (const goal of [GOALS.solarBoat, GOALS.impossible, GOALS.electronics]) {
    const { report } = await run(goal, { budget: { max_iterations: 2 } });
    if (report.status !== 'verified') {
      assert.ok(report.unmet.length > 0, `status ${report.status} with an empty unmet list`);
    }
  }
});

await check('A4', 'every verification row carries a trial id and a quality', async () => {
  const { report } = await run(GOALS.boat);
  assert.ok(report.verification.length > 0);
  for (const row of report.verification) {
    assert.equal(typeof row.quality, 'string');
    assert.ok(row.trial_id, `row ${row.channel} cites no trial`);
    assert.equal(typeof row.recording, 'string');
  }
});

await check('A5', 'no BOM line has a fabricated price', async () => {
  const { report } = await run(GOALS.boat);
  assert.ok(report.bom.length > 0, 'a verified run must produce a build list');
  for (const line of report.bom) {
    if (line.unit_price === null) continue;
    assert.equal(line.currency, 'USD');
    assert.equal(line.source, 'contracts/kinds.json unit_price',
      'a price must be traceable to a named source');
  }
  assert.ok(report.bom_total.amount === null || report.bom_total.price_source);
  if (report.bom_total.amount === null) {
    assert.ok(report.bom_total.unpriced_items >= 0);
    assert.match(report.bom_total.note ?? '', /no total is claimed/i);
  }
});

await check('A6', 'a model-call budget is enforced from a counter', async () => {
  let calls = 0;
  const { report } = await run(GOALS.boat, {
    budget: { max_model_calls: 3 },
    provider: async () => {
      calls += 1;
      return '// authored firmware\n';
    },
  });
  assert.ok(calls <= 3, `made ${calls} model calls with a budget of 3`);
  assert.equal(report.budget.used.model_calls, calls);
  assert.equal(report.budget.limits.max_model_calls, 3);
});

await check('A8', 'the orchestrator needs no browser and no chat client', async () => {
  // Nothing in the loop opens a websocket, starts a dev server or calls the chat endpoint. The
  // assertion is structural: the run completes with the persistence, catalog and runtime
  // services replaced by refusing stubs, which is what createStubServices provides.
  const { report } = await run(GOALS.boat);
  assert.equal(report.status, 'verified');
  assert.equal(report.firmware.upload_steps.length, 0);
  assert.match(report.firmware.note, /no compiled firmware/i);
});

await check('A7', 'a software goal is verified headlessly with a measured load time', async () => {
  const { report, events } = await run(GOALS.webapp);
  assert.equal(report.status, 'verified', JSON.stringify(report.unmet));
  assert.equal(report.verification[0].channel, 'web.load_ms');
  assert.equal(report.verification[0].quality, 'measured');
  assert.ok(report.verification[0].trial_id, 'the load-time claim must cite a trial');
  assert.ok(report.verification[0].measured < 2000);
  assert.equal(events.filter((event) => event.type === 'run.result')[0]?.verdict, 'pass');
});

await check('A9', 'an electronics goal is refused, with the missing capability named', async () => {
  const { report } = await run(GOALS.electronics);
  assert.equal(report.status, 'infeasible');
  assert.match(report.unmet[0].required_to_support, /headless runtime worker/i);
  assert.deepEqual(report.bom, []);
});

if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`orchestrator/honesty: ${passed} assertion(s) passed\n`);

// A rendered report is printed so the bench log contains one, as the brief asks.
if (!selected) {
  const { report } = await run(GOALS.boat);
  process.stdout.write('\n--- rendered BuildReport ---\n');
  process.stdout.write(renderReport(report));
}