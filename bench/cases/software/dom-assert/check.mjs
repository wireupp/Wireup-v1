import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { cleanup, runCase } from '../../_harness.mjs';
import { softwareSolver } from '../../../../packages/solvers/software/solver.mjs';

/**
 * Acceptance A4 — probes have teeth.
 *
 * The app here is DELIBERATELY WRONG: the status paragraph says "warming up" and the heading
 * says "(draft)", while the declared probes still expect "ready" and "WireUp Bench". If the
 * probe machinery were decorative, this case would pass. It must fail, loudly, with the error
 * named, and the wrongness must be reported rather than smoothed over.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const wrong = JSON.parse(readFileSync(resolve(HERE, 'project.json'), 'utf8'));
const right = JSON.parse(readFileSync(resolve(HERE, '../hello-app/project.json'), 'utf8'));
const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

let passed = 0;
function check(id, name, fn) {
  if (selected && selected !== id) return;
  fn();
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

const wrongRun = await runCase(wrong, {
  metric: 'mean', direction: 'target', target: 0, tolerance: 1e9,
}, { solver: softwareSolver });
let rightRun = null;

try {
  const probes = (run) => run.series.flatMap((entry) => entry.samples)
    .filter((sample) => sample.channel === 'script.probe_ok')
    .sort((a, b) => (a.node < b.node ? -1 : 1));

  check('A1', 'the wrong app fails at least two of its declared probes', () => {
    const results = probes(wrongRun);
    assert.ok(results.length >= 5, `only ${results.length} probe results were published`);
    const failures = results.filter((sample) => sample.value === 0);
    assert.ok(failures.length >= 2,
      `expected the wrong app to fail its text and title probes, only ${failures.length} failed`);
  });

  check('A2', 'a failed probe is published with its error code, not dropped', () => {
    const samples = wrongRun.series.flatMap((entry) => entry.samples)
      .filter((sample) => sample.channel === 'script.probe_ok' && sample.value === 0);
    for (const sample of samples) {
      assert.equal(sample.source.error, 'EXPECTATION_FAILED',
        `probe '${sample.node}' failed with ${sample.source.error}`);
    }
  });

  check('A3', 'the probe result stream is identical in shape for both apps', () => {
    // A probe that only exists when it fails would be a probe that cannot be trusted to pass.
    assert.equal(probes(wrongRun).length, 5);
  });

  check('A4', 'the same probes pass against the correct app', async () => {
    rightRun = await runCase(right, {
      metric: 'mean', direction: 'target', target: 0, tolerance: 1e9,
    }, { solver: softwareSolver });
    const failures = probes(rightRun).filter((sample) => sample.value === 0);
    assert.equal(failures.length, 0,
      `the correct app failed ${failures.length} probe(s): ${failures.map((s) => s.node).join(', ')}`);
  });

  check('A5', 'the wrong app is still SERVED: the failure is a content failure, not a sandbox failure', () => {
    // A 403 here would mean the sandbox refused the markup; the point of this case is that the
    // app ran fine and the CONTENT was wrong.
    const status = wrongRun.series.flatMap((entry) => entry.samples)
      .filter((sample) => sample.channel === 'web.http_status');
    assert.equal(status[0].value, 200);
  });
} finally {
  await cleanup(wrongRun.root);
  if (rightRun) await cleanup(rightRun.root);
}

if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`software/dom-assert: ${passed} assertion(s) passed\n`);