import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { assertWithin, channel, cleanup, runCase } from '../../_harness.mjs';

/**
 * Acceptance A1/A3 — a quadrotor, four rotors, a declared altitude-hold loop, and real wind.
 *
 * Two claims are made, and they are deliberately different claims:
 *
 *   A1  The altitude loop holds the DECLARED setpoint to within 3%.
 *   A3  The force required to hold the airframe against a wind of increasing speed rises
 *       MONOTONICALLY. This solver has a vertical altitude loop only: it has no attitude
 *       controller and no horizontal position hold, so "thrust required to hover" does not
 *       depend on wind in this model. Saying otherwise would be a fabricated result. What
 *       does depend on wind — and is asserted instead — is the force the airframe must fight.
 *
 * Every rotor's thrust is re-derived from its declared Ct, blade area and the measured RPM, so
 * A2 is an independent check of the aerodynamics rather than a restatement of it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(resolve(HERE, 'project.json'), 'utf8'));
const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

const airframe = graph.nodes.find((node) => node.kind === 'mech.airframe').properties;
const rotors = graph.nodes.filter((node) => node.kind === 'mech.rotor').map((node) => node.properties);
const law = graph.nodes.find((node) => node.kind === 'mech.control_law').properties;
const airspace = graph.nodes.find((node) => node.kind === 'env.airspace').properties;

const P_AIR = 101325 * ((288.15 - 0.0065 * airspace.altitude_m) / 288.15)
  ** (9.80665 / (287.058 * 0.0065));
const RHO_AIR = P_AIR / (287.058 * 288.15);

let passed = 0;
function check(id, name, fn) {
  if (selected && selected !== id) return;
  fn();
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

async function fly(windSpeed) {
  const variant = structuredClone(graph);
  const air = variant.nodes.find((node) => node.kind === 'env.airspace');
  air.properties.wind = { x: windSpeed, y: 0, z: 0 };
  const { result, series, root } = await runCase(variant, {
    metric: 'mean', direction: 'target', target: 0, tolerance: 1e9,
  }, {});
  return { result, series, root, windSpeed };
}

const calm = await fly(0);
try {
  const altitude = channel(calm.series, 'alt.m');
  const rpm = channel(calm.series, 'rotor.rpm');
  const thrust = channel(calm.series, 'rotor.thrust_n', { quality: 'derived' });

  check('A1', 'the altitude loop holds the declared setpoint within 3%', () => {
    assert.equal(calm.result.verdict, 'pass', `verdict was ${calm.result.verdict}`);
    const tail = altitude.filter((sample) => sample.t >= altitude.at(-1).t - 5);
    const mean = tail.reduce((sum, sample) => sum + sample.value, 0) / tail.length;
    assertWithin(mean, law.setpoint, 0.03, 'held altitude');
  });

  check('A2', 'rotor thrust equals Ct*rho*A*v_tip^2 for the measured RPM', () => {
    assert.ok(rpm.length > 100, 'no rotor RPM was published');
    assert.ok(thrust.length > 100, 'no rotor thrust was published');
    const rotor = rotors[0];
    const paired = thrust.filter((sample) => rpm.some((r) => r.t === sample.t));
    assert.ok(paired.length > 100, 'thrust and RPM could not be paired');
    for (const sample of paired.slice(0, 50)) {
      const measuredRpm = rpm.find((r) => r.t === sample.t).value;
      const tip = (2 * Math.PI * measuredRpm / 60) * (rotor.diameter_m / 2);
      const expected = rotor.thrust_coefficient * RHO_AIR * rotor.blade_area_m2 * tip ** 2;
      assertWithin(sample.value, expected, 0.02, `thrust at ${measuredRpm.toFixed(0)} rpm`);
    }
  });
} finally {
  await cleanup(calm.root);
}

// A3 needs three additional flights, so it owns its own runs and its own cleanup.
const windy = [];
try {
  for (const speed of [2, 5, 9]) windy.push(await fly(speed));
  const peaks = windy.map((run) => {
    const drag = channel(run.series, 'airframe.drag_n', { quality: 'derived' });
    assert.ok(drag.length > 10, `no airframe drag was published at ${run.windSpeed} m/s`);
    return Math.max(...drag.map((sample) => sample.value));
  });
  check('A3', 'the force needed against wind rises monotonically with wind speed', () => {
    windy.forEach((run, index) => {
      const expected = 0.5 * RHO_AIR * airframe.cd * airframe.area_m2 * run.windSpeed ** 2;
      assertWithin(peaks[index], expected, 0.02, `holding force at ${run.windSpeed} m/s`);
    });
    assert.ok(peaks[0] < peaks[1] && peaks[1] < peaks[2],
      `holding force was not monotonic in wind speed: ${peaks.join(', ')}`);
  });
} finally {
  for (const run of windy) await cleanup(run.root);
}

if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`mechanics/drone-hover: ${passed} assertion(s) passed\n`);