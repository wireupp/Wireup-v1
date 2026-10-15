import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertWithin, channel, cleanup, runCase } from '../../_harness.mjs';

/**
 * Acceptance A1 — buoyancy against closed form.
 *
 * Independent quantities, all derived from the DECLARED node properties rather than from
 * anything the solver reports:
 *
 *   waterplane area   A  = length * beam
 *   restoring stiffness  k  = rho * g * A
 *   natural period       T  = 2*pi*sqrt(m / k)
 *   equilibrium draft  V_sub = m / rho
 *
 * A hull that "floats" because a coefficient was nudged until it looked right would fail
 * every one of these. That is the point.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(resolve(HERE, 'project.json'), 'utf8'));
const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

const GRAVITY = 9.80665;
const node = graph.nodes.find((entry) => entry.kind === 'mech.float').properties;
const water = graph.nodes.find((entry) => entry.kind === 'env.water_body').properties;

const area = node.length * node.beam;
const stiffness = water.density * GRAVITY * area;
const effectiveMass = node.mass_kg * (1 + (node.added_mass?.z ?? 0));
const expectedPeriod = 2 * Math.PI * Math.sqrt(effectiveMass / stiffness);
const expectedDisplaced = node.mass_kg / water.density;
const expectedDepth = expectedDisplaced / area;

let passed = 0;
async function check(id, name, fn) {
  if (selected && selected !== id) return;
  await fn();
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

const { result, series, root } = await runCase(graph, {
  metric: 'mean', direction: 'target', target: 0, tolerance: 1e9,
}, {});

try {
  await check('A1', 'the trial completes without a solver error', () => {
    assert.equal(result.verdict, 'pass', `verdict was ${result.verdict}: ${JSON.stringify(result.runs[0]?.error ?? {})}`);
  });

  const heights = channel(series, 'body.position.z');
  const displaced = channel(series, 'hull.displaced_m3', { quality: 'derived' });

  await check('A2', 'the equilibrium draft matches V_sub = m/rho within 2%', () => {
    assert.ok(heights.length > 100, `only ${heights.length} position samples were recorded`);
    const tail = heights.filter((sample) => sample.t >= heights.at(-1).t - 2);
    const mean = tail.reduce((sum, sample) => sum + sample.value, 0) / tail.length;
    // The node origin is the TOP of the declared hull box, so the keel is at
    // z - draft. Draft below the waterline is surface - keel, not surface - origin.
    const keel = mean - node.draft;
    assertWithin(water.surface_z - keel, expectedDepth, 0.02, 'equilibrium draft');
  });

  await check('A3', 'the displaced volume equals the body mass over water density within 2%', () => {
    const tail = displaced.filter((sample) => sample.t >= displaced.at(-1).t - 2);
    const mean = tail.reduce((sum, sample) => sum + sample.value, 0) / tail.length;
    assertWithin(mean, expectedDisplaced, 0.02, 'displaced volume');
  });

  await check('A4', 'the oscillation period matches 2*pi*sqrt(m/k) within 5%', () => {
    // The equilibrium is the mean of the settled window (the oscillation is symmetric about
    // it), and the period is the mean spacing of consecutive UPWARD crossings, linearly
    // interpolated. Interpolation matters: at 200 Hz a raw index would only resolve the
    // period to ~3%, which is most of the tolerance.
    const tail = heights.filter((sample) => sample.t >= 3);
    const level = tail.reduce((sum, sample) => sum + sample.value, 0) / tail.length;
    const crossings = [];
    for (let index = 1; index < tail.length; index += 1) {
      const previous = tail[index - 1];
      const current = tail[index];
      if (previous.value <= level && current.value > level) {
        const fraction = (level - previous.value) / (current.value - previous.value);
        crossings.push(previous.t + fraction * (current.t - previous.t));
      }
    }
    assert.ok(crossings.length >= 3, `only ${crossings.length} upward crossings were found`);
    const spacings = [];
    for (let index = 1; index < crossings.length; index += 1) spacings.push(crossings[index] - crossings[index - 1]);
    const measured = spacings.reduce((sum, value) => sum + value, 0) / spacings.length;
    assertWithin(measured, expectedPeriod, 0.05, 'oscillation period');
  });

  await check('A5', 'the oscillation damps: the envelope shrinks by more than 20%', () => {
    const firstWindow = heights.filter((sample) => sample.t >= 3 && sample.t < 3.6);
    const lastWindow = heights.filter((sample) => sample.t >= heights.at(-1).t - 0.6);
    const spread = (window) => Math.max(...window.map((sample) => sample.value))
      - Math.min(...window.map((sample) => sample.value));
    const before = spread(firstWindow);
    const after = spread(lastWindow);
    assert.ok(after < before * 0.8, `envelope did not decay: ${before} -> ${after}`);
  });
} finally {
  await cleanup(root);
}

if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`mechanics/buoyancy: ${passed} assertion(s) passed\n`);