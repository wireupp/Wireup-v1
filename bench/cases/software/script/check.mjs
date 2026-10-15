import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { cleanup, runCase } from '../../_harness.mjs';
import { softwareSolver } from '../../../../packages/solvers/software/solver.mjs';

/**
 * A declared telemetry program, evaluated by the trial probe evaluator: bounded, total,
 * side-effect free. `value * 2` is arithmetic over a measured DOM value; there is no I/O in
 * the language at all, which is why it is safe to run on agent-authored content.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(resolve(HERE, 'project.json'), 'utf8'));
const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

let passed = 0;
function check(id, name, fn) {
  if (selected && selected !== id) return;
  fn();
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

const { result, series, root } = await runCase(graph, {
  metric: 'mean', direction: 'target', target: 0, tolerance: 1e9,
}, { solver: softwareSolver });

try {
  const scriptProbes = series.flatMap((entry) => entry.samples)
    .filter((sample) => sample.channel === 'script.probe_value' && sample.node.startsWith('software_script_1'));

  check('A1', 'the declared program runs and both of its assertions pass', () => {
    assert.equal(result.verdict, 'pass', `verdict was ${result.verdict}`);
    assert.equal(scriptProbes.length, 2, `expected 2 script probe results, got ${scriptProbes.length}`);
    assert.ok(scriptProbes.every((sample) => sample.quality === 'measured'));
    const doubled = scriptProbes.find((sample) => sample.node.endsWith('count-doubled'));
    assert.equal(doubled.value, 4, 'value * 2 over a measured count of 2 must be 4');
  });

  check('A2', 'the program is arithmetic over measured values, with no side effects', () => {
    const inRange = scriptProbes.find((sample) => sample.node.endsWith('count-in-range'));
    assert.equal(inRange.value, true);
    // If the evaluator could reach the filesystem or the network, a run that only reads a
    // count would have no reason to leave anything behind. Assert the run touched nothing else.
    const channels = new Set(series.flatMap((entry) => entry.samples).map((sample) => sample.channel));
    assert.deepEqual([...channels].sort(), [
      'script.probe_ok', 'script.probe_value', 'web.document_bytes', 'web.http_status', 'web.load_ms',
    ]);
  });

  check('A3', 'the script kind documents that it is not a general-purpose interpreter', () => {
    const kind = softwareSolver.manifest.unavailable.find((entry) => entry.kind === 'software.script');
    assert.ok(kind, 'the script kind must carry an unavailable entry');
    assert.match(kind.feature, /agent-authored script execution/);
    assert.match(kind.reason, /no enforced network boundary/i);
    assert.ok(kind.requiredToSupport.length > 30);
  });
} finally {
  await cleanup(root);
}

if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`software/script: ${passed} assertion(s) passed\n`);