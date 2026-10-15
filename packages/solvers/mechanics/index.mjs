/**
 * The mechanics solver manifest and implementation.
 *
 * Phase v11 replaced the v06 "declared unavailable" stub with the real solver. The honest
 * part of this file is `manifest.unavailable`: it lists, by name, everything this solver
 * does not do, so an agent reading capability.json is told rather than left to discover it
 * by being lied to.
 */

export { mechanicsSolver, manifest } from './solver.mjs';
export { buildWorld, sampleWorld, stepWorld, waveHeightAt, DEFAULT_TIMESTEP } from './world.mjs';
export { ActuatorBus, applyTransfer, sensorReading } from './actuators.mjs';
export { applyAddedMass, buoyancy, createWater, froudeRegime, metacentricHeight } from './fluid.mjs';
export { airframeDrag, hoverRpm, rotorForces, standardAtmosphere } from './aero.mjs';
export {
  createBody, integrateStep, boxInertia, sphereInertia,
} from './rigidbody.mjs';