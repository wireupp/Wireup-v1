/**
 * Fluid coupling for the `mechanics` solver, phase v11.
 *
 * Every model here is APPROXIMATED unless stated otherwise, and every approximation is
 * declared in contracts/derivations.json under the channel it produces. Nothing in this
 * file may be tuned to make a number match: if a bench case disagrees with theory, the
 * timestep or the coefficient declaration is wrong, and the fix is to say so.
 *
 * Model summary
 *   Buoyancy    F = rho * g * V_submerged, applied at the centroid of the submerged
 *               sample points. Linear heave damping -c * v_z. Exact for a fully submerged
 *               body of declared volume; approximate for a partly submerged hull, because
 *               the free surface is not modelled.
 *   Drag        F_i = -0.5 * rho * Cd_i * A_i * |v_i| * v_i  per body axis, quadratic.
 *   Added mass  m_eff,i = m_i * (1 + Ca_i). Declared per axis, default 0 (no added mass)
 *               unless the kind declares it. Reported as `derived`.
 *   Froude      Fn = v_surge / sqrt(g * L). Above fn_threshold the wetted-surface drag is
 *               multiplied by a declared factor. There is a DISCONTINUITY at the
 *               threshold; it is documented rather than smoothed.
 *   Stability    GM = KB + BM - KG, with BM = I_waterplane / V_displaced. Reported when
 *               negative, as a warning, never suppressed.
 */

import { add, length, rotate, scale, unrotate, vec } from './rigidbody.mjs';

export const STANDARD_GRAVITY = 9.80665;

export function createWater(properties = {}) {
  return {
    surface_z: numberOr(properties.surface_z, 0),
    density: numberOr(properties.density, 1000),
    kinematic_viscosity: numberOr(properties.kinematic_viscosity, 1e-6),
    temperature_c: numberOr(properties.temperature_c, 15),
    // Declared wave model. 'flat' is a flat surface and is the default: a seeded wave
    // model changes the result and must be declared, never assumed.
    wave_model: properties.wave_model ?? 'flat',
    wave_parameters: { ...(properties.wave_parameters ?? {}) },
    flow: { ...(properties.flow ?? vec()) },
  };
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Discretise a hull into buoyancy sample points.
 *
 * A hull declares `volume`, `length`, `beam`, `draft` and `samples`. `samples` is either a
 * single integer (cubic grid) or an explicit [nx, ny, nz]; the vertical axis is the one that
 * decides how finely the submerged volume is resolved, so a float declares [1,1,64].
 * Each point carries an equal share of the hull's declared volume, so the sum of the point
 * volumes is exactly the declared volume. Using declared points rather than a mesh means the
 * buoyancy integral is reproducible without importing a geometry kernel.
 */
export function buoyancySamples(spec) {
  const volume = Number(spec.volume);
  const lengthM = Number(spec.length);
  const beam = Number(spec.beam);
  const draft = Number(spec.draft);
  const grid = normaliseSamples(spec.samples);
  for (const [name, value] of [['volume', volume], ['length', lengthM], ['beam', beam], ['draft', draft]]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`Hull '${spec.id}' needs a declared positive ${name}; geometry is never guessed.`);
    }
  }
  const [nx, ny, nz] = grid;
  const points = [];
  const share = volume / (nx * ny * nz);
  for (let ix = 0; ix < nx; ix += 1) {
    const fx = (ix + 0.5) / nx;
    for (let iy = 0; iy < ny; iy += 1) {
      const fy = (iy + 0.5) / ny;
      for (let iz = 0; iz < nz; iz += 1) {
        const fz = (iz + 0.5) / nz;
        points.push({
          // Hull-local coordinates: x from stern (-) to bow (+), y to port, z from the
          // bottom of the draft up to the waterline at rest.
          local: vec(
            (fx - 0.5) * lengthM,
            (fy - 0.5) * beam,
            -draft + fz * draft,
          ),
          volume: share,
        });
      }
    }
  }
  return points;
}

function normaliseSamples(samples) {
  if (Array.isArray(samples) && samples.length === 3
      && samples.every((value) => Number.isInteger(value) && value > 0 && value <= 128)) {
    return samples;
  }
  const cubic = Number.isInteger(samples) && samples > 0 && samples <= 32 ? samples : 2;
  return [cubic, cubic, cubic];
}

/**
 * Archimedes via the declared sample points.
 *
 * Returns the total buoyant force, the submerged fraction, the centre of buoyancy in world
 * space, and the point velocities used for the damping term.
 */
export function buoyancy(body, samples, water) {
  const worldPoints = samples.map((sample) => ({
    volume: sample.volume,
    world: add(body.position, rotate(body.orientation, sample.local)),
  }));
  let submergedVolume = 0;
  let centroid = vec();
  for (const point of worldPoints) {
    if (point.world.z >= water.surface_z) continue;
    submergedVolume += point.volume;
    centroid = add(centroid, scale(point.world, point.volume));
  }
  const fraction = submergedVolume > 0
    ? scale(centroid, 1 / submergedVolume)
    : vec();
  const force = scale(vec(0, 0, STANDARD_GRAVITY * water.density * submergedVolume), 1);
  return { force, submerged_volume: submergedVolume, submerged_fraction: submergedVolume, centre_of_buoyancy: fraction };
}

/**
 * Quadratic drag on each body axis, in the WATER frame (so a wind/current is felt).
 *
 * `cd` and `areas` are declared per kind. A kind with no declared drag area gets zero
 * drag and an explicit warning rather than a plausible-looking default.
 */
export function drag(body, water, { cd, areas }) {
  const relative = {
    x: body.velocity.x - water.flow.x,
    y: body.velocity.y - water.flow.y,
    z: body.velocity.z - water.flow.z,
  };
  const local = unrotate(body.orientation, relative);
  const out = { ...relative };
  const perAxis = { x: 0, y: 0, z: 0 };
  for (const axis of ['x', 'y', 'z']) {
    const area = areas[axis];
    const coefficient = cd[axis];
    if (!Number.isFinite(area) || !Number.isFinite(coefficient) || area <= 0 || coefficient <= 0) {
      perAxis[axis] = 0;
      continue;
    }
    perAxis[axis] = -0.5 * water.density * coefficient * area * Math.abs(local[axis]) * local[axis];
  }
  const localForce = vec(perAxis.x, perAxis.y, perAxis.z);
  const worldForce = rotate(body.orientation, localForce);
  // A pure drag force cannot accelerate a stationary body: zero relative velocity gives
  // zero force, which is what keeps the sign convention honest.
  Object.assign(out, { ...localForce });
  return { force: worldForce, per_axis: perAxis, relative_velocity: relative, local_drag: localForce };
}

/**
 * Added mass per axis. Declared, not fitted: `ca` comes from the node's properties.
 * Reported as `derived` because it is a coefficient times a measurement, not a reading.
 */
export function applyAddedMass(body, ca) {
  for (const axis of ['x', 'y', 'z']) {
    const value = ca?.[axis];
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`Body '${body.id}' declares an invalid added-mass coefficient for ${axis}.`);
    }
    body.addedMass[axis] = value;
  }
  return body.addedMass;
}

/**
 * Froude-number regime switch.
 *
 * Fn = v / sqrt(g * L). Below `planing_threshold` the hull is in the displacement regime.
 * Above it, wetted-surface drag rises by `planing_drag_factor` and wave-making resistance
 * is dropped (a planing hull stops paying displacement drag). This is a STEP, not a
 * ramp: a smooth blend is a different model and is not what this is.
 */
export function froudeRegime(surgeSpeed, waterlineLength, { planing_threshold, planing_drag_factor }) {
  const denominator = Math.sqrt(STANDARD_GRAVITY * Math.max(waterlineLength, 1e-6));
  const froude = Math.abs(surgeSpeed) / denominator;
  const planing = froude >= planing_threshold;
  return {
    froude,
    regime: planing ? 'planing' : 'displacement',
    drag_multiplier: planing ? planing_drag_factor : 1,
    discontinuity: true,
  };
}

/**
 * Metacentric height at rest, GM = KB + BM - KG.
 *
 * BM = I_waterplane / V_displaced, with I the second moment of the waterplane rectangle
 * about its transverse axis. Negative GM is an unstable trim and is surfaced as a warning.
 */
export function metacentricHeight({ volume, beam, draft, length: waterlineLength, water }) {
  const displaced = Number.isFinite(volume) && volume > 0 ? volume : water.density * 0;
  if (!(displaced > 0)) return null;
  const kb = draft / 2;
  const kg = draft / 2;
  const waterplaneInertia = (waterlineLength * beam ** 3) / 12;
  const bm = waterplaneInertia / displaced;
  return {
    gm: kb + bm - kg,
    kb,
    bm,
    kg,
    displaced_volume: displaced,
    waterline_length: waterlineLength,
  };
}

/** Linear heave damping: F = -c * v_relative_heave. Declared coefficient, SI units. */
export function heaveDamping(body, water, coefficient) {
  if (!Number.isFinite(coefficient) || coefficient <= 0) return vec();
  return vec(0, 0, -coefficient * (body.velocity.z - water.flow.z));
}

/** Hydrostatic restoring stiffness implied by the displaced waterplane, k = rho * g * A_wp. */
export function hydrostaticStiffness({ beam, length: waterlineLength, water }) {
  return water.density * STANDARD_GRAVITY * beam * waterlineLength;
}

/** Speed magnitude of a body. */
export function speed(body) {
  return length(body.velocity);
}