import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertWithin, channel, cleanup, runCase } from '../../_harness.mjs';

/**
 * Acceptance A3/A4 — the pin-to-force bridge, in both directions, in one run.
 *
 *   physics  ->  depth.m / baro.pa telemetry  ->  declared control law  ->  trim.pwm  ->  force
 *
 * A1 checks the forward direction (a commanded PWM becomes force on a body, inside the same
 * run, with no manual step). A2/A3 check the reverse direction (a physics-derived channel
 * changes what the "firmware" commands). A4 checks that the loop actually closes: the depth
 * converges to the declared setpoint.
 *
 * The "firmware" here is a DECLARED control law, not compiled firmware. Headless firmware
 * execution is unavailable in this platform (see the v07 phase report), and the solver calls
 * it a control law rather than pretending otherwise.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(resolve(HERE, 'project.json'), 'utf8'));
const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

const fluid = graph.nodes.find((node) => node.kind === 'env.water_body').properties;
const law = graph.nodes.find((node) => node.kind === 'mech.control_law').properties;
const sensor = graph.nodes.find((node) => node.kind === 'mech.depth_sensor').properties;
const actuator = graph.nodes.find((node) => node.kind === 'actuator.force').properties;

let passed = 0;
function check(id, name, fn) {
  if (selected && selected !== id) return;
  fn();
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

const { result, series, root } = await runCase(graph, {
  metric: 'mean', direction: 'target', target: 0, tolerance: 1e9,
}, {});

try {
  const depth = channel(series, 'depth.m');
  const pressure = channel(series, 'baro.pa');
  const command = channel(series, 'pwm.duty');
  const force = channel(series, 'thruster.thrust_n', { quality: 'derived' });

  check('A1', 'the coupled run completes with no solver error', () => {
    assert.equal(result.verdict, 'pass', `verdict was ${result.verdict}`);
    assert.ok(depth.length > 100, `only ${depth.length} depth samples were recorded`);
  });

  check('A2', 'physics writes telemetry: the barometer reading tracks hull depth', () => {
    // Hydrostatics: p = p0 + rho*g*depth, with the depth of the hull's keel, not its origin.
    assert.ok(pressure.length > 100, 'the barometer published nothing');
    const surface = 101325;
    const maxDepth = Math.max(...depth.map((s) => s.value));
    assertWithin(Math.max(...pressure.map((s) => s.value)), surface + fluid.density * 9.80665 * maxDepth,
      0.02, 'peak barometer pressure');
    assertWithin(Math.min(...pressure.map((s) => s.value)), surface + fluid.density * 9.80665
      * Math.min(...depth.map((s) => s.value)), 0.02, 'trough barometer pressure');
    // And the reading must actually move: a constant is not physics.
    const spread = Math.max(...pressure.map((s) => s.value)) - Math.min(...pressure.map((s) => s.value));
    assert.ok(spread > 1, `the barometer reading never changed (spread ${spread})`);
  });

  check('A3', 'firmware responds: the PWM is computed from the measured depth, not held constant', () => {
  const distinct = new Set(command.map((s) => s.value.toFixed(6)));
  assert.ok(distinct.size > 5, `the PWM took only ${distinct.size} distinct values; the loop is not reacting`);
  const byTime = new Map(depth.map((s) => [s.t, s.value]));
  // 1. Cold start: the hull is 0.10 m too deep, so a controller that reads the depth sensor
  //    must saturate. A controller that ignores the sensor stays at its initial output.
  const reacting = command.filter((s) => Math.abs(s.value) > 0.9);
  assert.ok(reacting.length > 0, 'the controller never reacted to the initial depth error');
  // 2. Steady state: the command equals the DECLARED law evaluated on the MEASURED depth.
  //    This is the assertion that actually ties the output to the physics channel.
  const tail = command.filter((s) => s.t >= command.at(-1).t - 5 && Math.abs(s.value) < 0.98);
  assert.ok(tail.length > 100, `only ${tail.length} unsaturated tail samples`);
  let worst = 0;
  for (const sample of tail) {
    const measured = byTime.get(sample.t);
    assert.ok(Number.isFinite(measured), `no depth reading at t=${sample.t}`);
    const predicted = clamp(law.gain * (law.setpoint - measured), law.min, law.max);
    worst = Math.max(worst, Math.abs(predicted - sample.value));
  }
  assert.ok(worst < 0.02,
    `the commanded PWM diverges from the declared law by ${worst.toFixed(4)}; it is not reading the sensor`);
});

  check('A4', 'the loop closes: the hull settles at the declared setpoint within 5%', () => {
    const tail = depth.filter((sample) => sample.t >= depth.at(-1).t - 5);
    const mean = tail.reduce((sum, sample) => sum + sample.value, 0) / tail.length;
    assertWithin(mean, law.setpoint, 0.05, 'settled depth');
  });

  check('A5', 'the commanded PWM becomes a force on the same body in the same run', () => {
    assert.ok(force.length > 100, 'no thrust channel was published');
    assert.ok(force.every((s) => s.quality === 'derived'),
      'the actuator force must be derived from the declared transfer function');
    const tail = force.filter((s) => s.t >= force.at(-1).t - 1);
    const meanForce = tail.reduce((sum, s) => sum + s.value, 0) / tail.length;
    const transfer = actuator.transfer;
    const tailCommand = command.filter((s) => s.t >= command.at(-1).t - 1);
    const meanCommand = tailCommand.reduce((sum, s) => sum + s.value, 0) / tailCommand.length;
    // The declared transfer, evaluated by hand: a bidirectional actuator centres its signal
    // at 0.5, so 0.633 of signal is 0.266 of travel, not 0.633.
    const centred = transfer.bidirectional
      ? Math.max(-1, Math.min(1, meanCommand * 2 - 1))
      : Math.max(0, Math.min(1, meanCommand));
    const travel = Math.min(transfer.saturation,
      Math.max(0, (Math.abs(centred) - transfer.deadband) / (1 - transfer.deadband)));
    const expectedForce = Math.sign(centred) * travel * transfer.gain;
    assertWithin(meanForce, expectedForce, 0.05, 'force from command');
  });
} finally {
  await cleanup(root);
}

if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`mechanics/coupling: ${passed} assertion(s) passed\n`);

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}