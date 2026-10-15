import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertWithin, channel, cleanup, runCase } from '../../_harness.mjs';

/**
 * Acceptance A1 — terminal velocity against closed form.
 *
 *   v_t = sqrt(2 m g / (rho Cd A))
 *
 * computed from the DECLARED mass, density, drag coefficient and reference area. Cd = 0.47 is
 * the declared value for a sphere; it is not fitted to make the assertion pass.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(resolve(HERE, 'project.json'), 'utf8'));
const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

const GRAVITY = 9.80665;
const body = graph.nodes.find((entry) => entry.kind === 'mech.body').properties;
const fluid = graph.nodes.find((entry) => entry.kind === 'env.water_body').properties;
const expected = Math.sqrt(
  (2 * body.mass_kg * GRAVITY) / (fluid.density * body.cd_heave * body.cd_area_heave_m2),
);

let passed = 0;
function check(id, name, fn) {
  if (selected && selected !== id) return;
  fn();
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

const { result, series, root } = await runCase(graph, {
  metric: 'max', direction: 'target', target: 0, tolerance: 1e9,
}, {});

try {
  check('A1', 'the trial completes without a solver error', () => {
    assert.equal(result.verdict, 'pass', `verdict was ${result.verdict}`);
  });

  const downward = channel(series, 'body.velocity.z');

  check('A2', 'the settled speed matches sqrt(2mg/(rho Cd A)) within 5%', () => {
    const tail = downward.filter((sample) => sample.t >= downward.at(-1).t - 2);
    const mean = tail.reduce((sum, sample) => sum + sample.value, 0) / tail.length;
    assertWithin(Math.abs(mean), expected, 0.05, 'terminal velocity');
  });

  check('A3', 'the descent is monotone: no speed is gained after settling', () => {
    const tail = downward.filter((sample) => sample.t >= 5);
    const first = Math.abs(tail[0].value);
    const last = Math.abs(tail.at(-1).value);
    assert.ok(last <= first * 1.001, `speed rose after settling: ${first} -> ${last}`);
  });

  check('A4', 'the speed is reported as measured, not assumed or derived', () => {
    assert.ok(downward.length > 100, `only ${downward.length} velocity samples were recorded`);
    assert.ok(downward.every((sample) => sample.quality === 'measured'));
  });
} finally {
  await cleanup(root);
}

if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`mechanics/terminal-velocity: ${passed} assertion(s) passed\n`);