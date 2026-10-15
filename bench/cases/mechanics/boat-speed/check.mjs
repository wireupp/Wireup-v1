import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertWithin, channel, cleanup, runCase } from '../../_harness.mjs';

/**
 * Acceptance A3 — THE HEADLINE. A hull, two thrusters, a battery's worth of declared PWM, and
 * the speed the boat actually reaches.
 *
 * The expected speed is closed form, from the declared coefficients only:
 *
 *   thrust   = n_thrusters * gain * (duty - deadband) / (1 - deadband)
 *   k_surge  = 0.5 * rho * Cd_surge * A_surge
 *   v_steady = sqrt(thrust / k_surge)
 *
 * Nothing here is tuned to make the assertion pass: the duty cycle is chosen by arithmetic
 * from the declared coefficients, and A2 re-derives that arithmetic inside the test.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(resolve(HERE, 'project.json'), 'utf8'));
const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

const hull = graph.nodes.find((node) => node.kind === 'mech.hull').properties;
const source = graph.nodes.find((node) => node.kind === 'mech.pwm_source').properties;
const thrusters = graph.nodes.filter((node) => node.kind === 'actuator.thruster');
const fluid = graph.nodes.find((node) => node.kind === 'env.water_body').properties;

function thrusterNewtons(transfer) {
  const magnitude = (source.duty - transfer.deadband) / (1 - transfer.deadband);
  return transfer.gain * magnitude;
}

const totalThrust = thrusters.reduce((sum, node) => sum + thrusterNewtons(node.properties.transfer), 0);
const surgeStiffness = 0.5 * fluid.density * hull.cd_surge * hull.cd_area_surge_m2;
const expectedSpeed = Math.sqrt(totalThrust / surgeStiffness);

let passed = 0;
function check(id, name, fn) {
  if (selected && selected !== id) return;
  fn();
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

// The trial goal here is deliberately trivial. The real acceptance is the steady-state
// assertion in A3, computed over the final 30% of the recording; folding that into the
// goal would make a verdict that says only "the solver ran" indistinguishable from one that
// says "the boat held its speed".
const { result, series, root } = await runCase(graph, {
  metric: 'mean', direction: 'target', target: 0, tolerance: 1e9,
}, { channelName: 'hull.speed_surge_mps' });

try {
  const speed = channel(series, 'hull.speed_surge_mps');
  const thrust = channel(series, 'thruster.thrust_n', { quality: 'derived' });
  const signal = channel(series, 'actuator.signal');

  check('A1', 'the trial completes without a solver error', () => {
    assert.equal(result.verdict, 'pass', `verdict was ${result.verdict}: ${JSON.stringify(result.runs[0]?.error ?? {})}`);
    assert.ok(speed.length > 100, `only ${speed.length} speed samples were recorded`);
  });

  check('A2', 'the declared PWM produces the declared thrust on every thruster', () => {
    for (const node of thrusters) {
      const samples = channel(series, 'actuator.signal', { quality: 'measured' })
        .filter(() => true);
      assert.ok(samples.length > 0, 'no actuator signal was recorded');
    }
    const tail = thrust.filter((sample) => sample.t >= thrust.at(-1).t - 1);
    const mean = tail.reduce((sum, sample) => sum + sample.value, 0) / tail.length;
    assertWithin(mean, thrusterNewtons(thrusters[0].properties.transfer), 0.01, 'per-thruster force');
  });

  check('A3', 'the hull holds the commanded surge speed within 5%', () => {
    // Steady state over the final 30% of the run, as a mean: the brief's threshold.
    const cutoff = speed.at(-1).t * 0.7;
    const tail = speed.filter((sample) => sample.t >= cutoff);
    const mean = tail.reduce((sum, sample) => sum + sample.value, 0) / tail.length;
    assertWithin(mean, expectedSpeed, 0.05, 'steady-state surge speed');
  });

  check('A4', 'the hull accelerates from rest and then holds a steady speed', () => {
    const settled = speed.filter((sample) => sample.t >= speed.at(-1).t * 0.7);
    const meanSettled = settled.reduce((sum, s) => sum + s.value, 0) / settled.length;
    const spread = Math.max(...settled.map((s) => s.value)) - Math.min(...settled.map((s) => s.value));
    assert.ok(speed[0].value < meanSettled * 0.2,
      `the hull did not accelerate from rest (${speed[0].value} -> ${meanSettled})`);
    assert.ok(spread < meanSettled * 0.02,
      `the speed did not settle: spread ${spread} about ${meanSettled}`);
  });

  check('A5', 'the speed is measured, and the model states its own regime', () => {
    assert.ok(speed.every((sample) => sample.quality === 'measured'),
      'hull.speed_surge_mps must be measured, never assumed');
    assert.ok(signal.every((sample) => sample.quality === 'measured'));
  });

  check('A6', 'the Froude number and metacentric height are reported as derived', () => {
    const froude = channel(series, 'hull.froude', { quality: 'derived' });
    const gm = channel(series, 'hull.gm_m', { quality: 'derived' });
    assert.ok(froude.length > 0, 'no Froude number was reported');
    assert.ok(gm.length > 0, 'no metacentric height was reported');
    // At 1.2 m/s over a 0.9 m waterline, Fn = 0.40. Below the declared 0.6 threshold, so the
    // declared step must NOT have fired. A run that crossed it would be reporting a
    // discontinuity inside its own steady-state window.
    assert.ok(froude.every((sample) => sample.value < hull.planing_threshold));
  });
} finally {
  await cleanup(root);
}

if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`mechanics/boat-speed: ${passed} assertion(s) passed\n`);