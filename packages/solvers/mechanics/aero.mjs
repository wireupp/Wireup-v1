/**
 * Aerodynamics for the `mechanics` solver, phase v11.
 *
 * Scope, stated plainly: this is a ROTOR MODEL, not a flight-dynamics package. It computes
 * rotor thrust and rotor drag from declared blade area, declared thrust coefficient and the
 * measured RPM. It does NOT model blade flapping, blade-element inflow, rotational flow,
 * vortex ring states, translational lift, or ground effect. Those are declared unavailable
 * in packages/solvers/mechanics/manifest.mjs, not silently omitted.
 *
 *   T = Ct * rho_air * A * v_tip^2      with v_tip = omega * R, omega = 2*pi*rpm/60
 *   D = T * induced_factor              a declared fraction of thrust
 *
 * Air density comes from the environment node (altitude + temperature through the
 * international standard atmosphere), never from a constant in this file.
 */

import { STANDARD_GRAVITY } from './fluid.mjs';

export const R_GAS = 287.058;
export const SEA_LEVEL_TEMPERATURE_K = 288.15;
export const SEA_LEVEL_PRESSURE_PA = 101325;
export const TEMPERATURE_LAPSE_K_PER_M = 0.0065;

/**
 * International Standard Atmosphere troposphere.
 *
 * Declared model, exact within the troposphere by definition of the standard. It is NOT
 * the real atmosphere and produces no weather: it is the reference the environment node's
 * recorded or live readings are compared against.
 */
export function standardAtmosphere(altitudeM, temperatureOverrideK) {
  const altitude = Number.isFinite(altitudeM) ? Math.max(0, altitudeM) : 0;
  if (altitude > 11000) {
    throw Object.assign(
      new Error(`Standard atmosphere is only defined to 11 km in this solver; ${altitude} m is refused rather than extrapolated.`),
      { code: 'ATMOSPHERE_OUT_OF_RANGE' },
    );
  }
  const temperature = Number.isFinite(temperatureOverrideK)
    ? temperatureOverrideK
    : SEA_LEVEL_TEMPERATURE_K - TEMPERATURE_LAPSE_K_PER_M * altitude;
  const pressure = SEA_LEVEL_PRESSURE_PA * (temperature / SEA_LEVEL_TEMPERATURE_K) ** (
    STANDARD_GRAVITY / (R_GAS * TEMPERATURE_LAPSE_K_PER_M)
  );
  return {
    temperature_k: temperature,
    pressure_pa: pressure,
    density: pressure / (R_GAS * temperature),
    altitude_m: altitude,
    model: 'ISA-troposphere',
  };
}

/** Rotation rate of a rotor from RPM. */
export function rotorOmega(rpm) {
  return (2 * Math.PI * Math.abs(rpm)) / 60;
}

/**
 * Thrust and drag for one rotor.
 *
 * @param {object} rotor declared: { diameter_m, blade_area_m2, thrust_coefficient,
 *                    induced_drag_factor, efficiency }
 * @param {number} rpm  measured rotor speed
 * @param {number} airDensity from the environment node
 */
export function rotorForces(rotor, rpm, airDensity) {
  for (const [name, value] of [
    ['diameter_m', rotor.diameter_m],
    ['blade_area_m2', rotor.blade_area_m2],
    ['thrust_coefficient', rotor.thrust_coefficient],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`Rotor '${rotor.id}' needs a declared positive ${name}; it is never guessed.`);
    }
  }
  const radius = rotor.diameter_m / 2;
  const omega = rotorOmega(rpm);
  const tipSpeed = omega * radius;
  const thrust = rotor.thrust_coefficient * airDensity * rotor.blade_area_m2 * tipSpeed ** 2;
  const factor = Number.isFinite(rotor.induced_drag_factor) ? rotor.induced_drag_factor : 1 / Math.PI;
  return {
    rpm,
    omega,
    tip_speed_mps: tipSpeed,
    thrust_n: thrust,
    drag_n: thrust * factor,
    coefficient: rotor.thrust_coefficient,
    model: 'rotor.disc',
  };
}

/** Quadrotor hover RPM for a declared total weight, ignoring ground effect. */
export function hoverRpm(rotor, mass, airDensity, rotorCount) {
  const perRotor = (mass * STANDARD_GRAVITY) / rotorCount;
  const tipSpeed = Math.sqrt(
    perRotor / (rotor.thrust_coefficient * airDensity * rotor.blade_area_m2),
  );
  return (tipSpeed * 60) / (2 * Math.PI * (rotor.diameter_m / 2));
}

/**
 * Translational drag on an airframe: F = -0.5 * rho * Cd * A * |v| * v, in world axes.
 * This is what makes wind a real load on a drone rather than a number in a report.
 */
export function airframeDrag(velocity, wind, airDensity, cd, area) {
  const relative = {
    x: velocity.x - wind.x,
    y: velocity.y - wind.y,
    z: velocity.z - wind.z,
  };
  const speed = Math.hypot(relative.x, relative.y, relative.z);
  if (speed === 0 || !(cd > 0) || !(area > 0)) {
    return { force: { x: 0, y: 0, z: 0 }, relative_velocity: relative, speed_mps: speed };
  }
  const magnitude = -0.5 * airDensity * cd * area * speed;
  return {
    force: { x: magnitude * relative.x, y: magnitude * relative.y, z: magnitude * relative.z },
    relative_velocity: relative,
    speed_mps: speed,
  };
}