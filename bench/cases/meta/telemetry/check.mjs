import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelemetryBus } from '../../../../packages/core/telemetry/bus.mjs';
import { TelemetryRecorder } from '../../../../packages/core/telemetry/recorder.mjs';
import * as metrics from '../../../../packages/core/trials/metrics.mjs';
import { evaluateGoal, runTrial, sweepTrial } from '../../../../packages/core/trials/runner.mjs';
import { runProbes } from '../../../../packages/core/trials/probes.mjs';

const root = await mkdtemp(join(tmpdir(), 'wireup-v05-'));
const selected = process.argv[2];
if (selected !== undefined && !/^A(?:[1-9]|10)$/.test(selected)) {
  throw new TypeError(`Unknown acceptance selector '${selected}'.`);
}
let passed = 0;

function check(name, fn) {
  if (selected && !name.startsWith(`${selected} `)) return;
  fn();
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
}

async function checkAsync(name, fn) {
  if (selected && !name.startsWith(`${selected} `)) return;
  await fn();
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function sample(overrides = {}) {
  return {
    project_id: '0123456789abcdef0123456789abcdef',
    t: 0,
    node: 'board_01234567',
    channel: 'pin.level',
    value: 1,
    quality: 'measured',
    solver: 'mcu',
    ...overrides,
  };
}

function baseGraph() {
  return {
    schema_version: 3,
    id: '0123456789abcdef0123456789abcdef',
    project_id: '0123456789abcdef0123456789abcdef',
    domain: 'electronics',
    revision: 0,
    nodes: [{
      id: 'relay_01234567',
      kind: 'electromech.relay',
      properties: { coil_resistance: 70, coil_voltage: 5 },
    }],
    edges: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function timeSeries(values) {
  return values.map((value, t) => ({ t, value }));
}

function expectThrow(fn, pattern) {
  assert.throws(fn, pattern);
}

check('A1 metric values match hand calculations', () => {
  const rising = timeSeries([0, 1, 2, 3]);
  const falling = timeSeries([3, 2, 1, 0]);
  const linear = timeSeries([0, 1, 2, 3]);
  const pair = timeSeries([0, 2, 4, 6]);
  const expected = [
    [metrics.mean(rising), 1.5],
    [metrics.rms(rising), Math.sqrt(3.5)],
    [metrics.stddev(rising), Math.sqrt(1.25)],
    [metrics.min(rising), 0],
    [metrics.max(rising), 3],
    [metrics.peakToPeak(rising), 3],
    [metrics.meanAbsolute(timeSeries([-2, -1, 1, 2])), 1.5],
    [metrics.riseTime(rising), 2],
    [metrics.fallTime(falling), 2],
    [metrics.settleTime(rising, 3, 0), 3],
    [metrics.steadyState(rising, 2), 2.5],
    [metrics.integral(rising), 4.5],
    [metrics.rate(linear), 1],
    [metrics.overshoot(rising, 2), 1],
    [metrics.timeToFirstCrossing(rising, 1.5), 2],
    [metrics.dutyCycle(rising, 1.5), 1 / 3],
    [metrics.correlation(rising, pair), 1],
    [metrics.linearFitSlope(linear), 1],
    [metrics.linearFitIntercept(linear), 0],
  ];
  for (const [result, value] of expected) {
    assert.equal(result.insufficient, false);
    assert.ok(Math.abs(result.value - value) <= 1e-6 * Math.max(1, Math.abs(value)));
  }
});

check('A2 insufficient data does not produce a verdict', () => {
  assert.deepEqual(metrics.stddev(timeSeries([1, 2])), {
    value: null,
    samples: 2,
    insufficient: true,
  });
  assert.deepEqual(evaluateGoal({ metric: 'mean', direction: 'target', target: 1, tolerance: 0 }, null), {
    verdict: 'error',
    code: 'INSUFFICIENT_DATA',
  });
});

await checkAsync('A3 invalid quality samples are rejected', async () => {
  const recorder = new TelemetryRecorder({ root: join(root, 'quality') });
  const recording = await recorder.create({
    trial_id: 'quality-check',
    project_id: '0123456789abcdef0123456789abcdef',
    graph_revision: 0,
    seed: 1,
  });
  try {
    await assert.rejects(recording.append([sample({
      channel: 'unlisted.derived',
      quality: 'derived',
    })]), /Invalid telemetry sample/);
    await assert.rejects(recording.append([sample({
      quality: 'unavailable',
      value: 1,
    })]), /unavailable telemetry must carry value:null/i);
  } finally {
    await recording.abort();
  }
});

await checkAsync('A4 identical NDJSON records compress byte-identically', async () => {
  const recordings = [];
  for (let index = 0; index < 10; index += 1) {
    const services = trialServices();
    const result = await runTrial(baseGraph(), {
      metric: 'mean',
      direction: 'target',
      target: 1,
      tolerance: 0,
    }, [], {}, 42, { ...services, repeats: 1 });
    assert.equal(result.verdict, 'pass');
    recordings.push(await readFile(join(
      services.recorder.root,
      'trials',
      'telemetry-bench-run-0',
      'telemetry.ndjson.gz',
    )));
  }
  const hashes = new Set(recordings.map((bytes) => createHash('sha256').update(bytes).digest('hex')));
  assert.equal(hashes.size, 1);
});

check('A5 bounded telemetry reports attempted, retained, and dropped counts', () => {
  const bus = new TelemetryBus({ capacity: 3 });
  for (let t = 0; t < 30; t += 1) bus.publish(sample({ t, value: t }));
  const [series] = bus.query({ projectId: '0123456789abcdef0123456789abcdef' });
  assert.equal(series.sample_count, 3);
  assert.equal(series.dropped, 27);
  assert.equal(series.attempted, 30);
  assert.equal(series.sample_count + series.dropped, series.attempted);
});

await checkAsync('A6 truncated gzip recording is surfaced', async () => {
  const recorder = new TelemetryRecorder({ root: join(root, 'truncated') });
  const recording = await recorder.create({
    trial_id: 'truncated-check',
    project_id: '0123456789abcdef0123456789abcdef',
    graph_revision: 0,
    seed: 1,
  });
  await recording.append([0, 1, 2].map((t) => sample({ t, value: t })));
  await recording.finish();
  const file = join(root, 'truncated', 'trials', 'truncated-check', 'telemetry.ndjson.gz');
  const bytes = await readFile(file);
  await writeFile(file, bytes.subarray(0, Math.floor(bytes.length / 2)));
  const reader = await recorder.openRecording('truncated-check');
  await assert.rejects(async () => {
    for await (const _sample of reader) {
      // Drain the stream to trigger gzip integrity verification.
    }
  }, (error) => error.code === 'RECORDING_TRUNCATED' && error.truncated);
  assert.equal(reader.truncated, true);
  reader.close();
});

function trialServices({ failOnSeed, signal, token } = {}) {
  const recorder = new TelemetryRecorder({ root: join(root, `trial-${Math.random().toString(16).slice(2)}`) });
  const telemetry = new TelemetryBus({ capacity: 1024 });
  return {
    recorder,
    telemetry,
    signal,
    runtimeToken: token,
    repeats: 2,
    id: () => 'telemetry-bench',
    clock: Date,
    async solve(graph, { seed }) {
      if (seed === failOnSeed) throw new Error('Intentional isolated solver failure.');
      return {
        async *[Symbol.asyncIterator]() {
          yield sample({ node: graph.nodes[0].id, t: 0, value: 1 });
          yield sample({ node: graph.nodes[0].id, t: 1, value: 1 });
          yield sample({ node: graph.nodes[0].id, t: 2, value: 1 });
        },
      };
    },
    computeMetric(_name, series) {
      return metrics.mean(series.flatMap((entry) => entry.samples));
    },
  };
}

const parameters = [
  { node: 'relay_01234567', property: 'coil_voltage', values: [5, 10, 15] },
  { node: 'relay_01234567', property: 'coil_resistance', values: [10, 20] },
];

await checkAsync('A7 Cartesian sweep order and failures are isolated', async () => {
  const result = await sweepTrial(baseGraph(), {
    metric: 'mean',
    direction: 'target',
    target: 1,
    tolerance: 0,
  }, parameters, {}, 100, trialServices({ failOnSeed: 106 }));
  assert.equal(result.runs.length, 12);
  assert.equal(result.summary.runs, 12);
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.passes, 11);
  assert.deepEqual(result.runs.map((run) => run.seed), Array.from({ length: 12 }, (_, index) => 100 + index));
  assert.deepEqual(result.runs[0].parameters, {
    relay_01234567: { coil_resistance: 10, coil_voltage: 5 },
  });
  assert.equal(result.runs[6].verdict, 'error');
});

await checkAsync('A8 cancellation returns partial results and cannot pass', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runTrial(baseGraph(), {
    metric: 'mean',
    direction: 'target',
    target: 1,
    tolerance: 0,
  }, parameters, {}, 200, trialServices({ signal: controller.signal }));
  assert.equal(result.verdict, 'error');
  assert.equal(result.summary.code, 'CANCELLED');
  assert.equal(result.runs.length, 12);
  assert.ok(result.runs.every((run) => run.verdict === 'error'));
});

await checkAsync('A9 hostile probe expressions are rejected without evaluation', async () => {
  const hostile = [
    'constructor.prototype.x',
    '__proto__ = 1',
    'this',
    'globalThis',
    'a.b.c.d',
    'while(true){}',
    'window',
    'global',
    'constructor',
    'prototype',
    'a[0]',
    'a()',
    '1; 2',
    'secret',
  ];
  const accepted = [
    '1 + 2 * 3',
    '(a + 2) / 3',
    'a >= 1 && b',
    '!false || b',
    'a === 1',
    '"ready" == "ready"',
    'null === null',
    '-a',
  ];
  const expressions = [
    ...hostile,
    ...Array.from({ length: 40 - hostile.length }, (_, index) => accepted[index % accepted.length]),
  ];
  const results = await runProbes(expressions.map((expression, index) => ({
    id: `probe-${index}`,
    target: { node: 'relay_01234567' },
    expression,
    timeout_ms: 1000,
  })), {
    read: async () => ({ state: { a: 1, b: true }, quality: 'measured' }),
  });
  assert.equal(results.length, 40);
  assert.ok(results.slice(0, hostile.length).every((result) => !result.ok));
  assert.ok(results.slice(hostile.length).every((result) => result.ok));
});

await checkAsync('A10 runtime tokens are absent from the trial result', async () => {
  const token = 'runtime-token-should-never-escape';
  const services = trialServices({ token });
  const result = await runTrial(baseGraph(), {
    metric: 'mean',
    direction: 'target',
    target: 1,
    tolerance: 0,
  }, [], {}, 300, {
    ...services,
    repeats: 1,
    async solve(graph) {
      return {
        async *[Symbol.asyncIterator]() {
          yield sample({ node: graph.nodes[0].id, value: token });
        },
      };
    },
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
  assert.equal(services.telemetry.query({
    projectId: '0123456789abcdef0123456789abcdef',
    trialId: 'telemetry-bench-run-0',
  }).length, 0);
});

await rm(root, { recursive: true, force: true });
if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`v05 telemetry acceptance: ${passed} assertion(s) passed\n`);
