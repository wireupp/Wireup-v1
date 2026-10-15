/**
 * Deterministic 6-DOF rigid body, phase v11.
 *
 * Integrator: semi-implicit (symplectic) Euler at a FIXED timestep. Chosen because it is
 * order-independent, allocation-free in the hot loop, and bit-for-bit reproducible for a
 * fixed graph, fixed seed and fixed timestep. No adaptive stepping: a variable step makes
 * the trajectory depend on floating-point accumulation order, which would break invariant
 * I9 (same graph + same seed => same result).
 *
 * Frame convention: world axes are x = surge (forward), y = sway (port), z = up (heave).
 * Body axes coincide with world axes at rest; rotation is stored as a unit quaternion.
 *
 * Units: metres, kilograms, seconds, newtons, radians. Nothing in this file is in SI
 * "engineering units"; a value in the wrong unit is a bug, never a convention.
 */

export const WORLD_AXES = Object.freeze(['x', 'y', 'z']);

/** A zero vector. Allocated once so the step loop never allocates. */
const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });

export function vec(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a, factor) {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}

export function length(a) {
  return Math.hypot(a.x, a.y, a.z);
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function isZero(a) {
  return a.x === 0 && a.y === 0 && a.z === 0;
}

/**
 * Principal-axis inertia tensor of a solid box about its centre of mass.
 *
 * Declared, not measured: a node that has a declared `inertia` uses it directly; a node
 * with only `size` gets the box formula. A node with neither is an error at build time
 * (see world.mjs), never a guess here.
 */
export function boxInertia(mass, size) {
  const { x, y, z } = size;
  return {
    x: (mass / 12) * (y * y + z * z),
    y: (mass / 12) * (x * x + z * z),
    z: (mass / 12) * (x * x + y * y),
  };
}

/** Solid-sphere inertia about its centre. */
export function sphereInertia(mass, radius) {
  const i = 0.4 * mass * radius * radius;
  return { x: i, y: i, z: i };
}

/**
 * Create a rigid body.
 *
 * @param {object} spec
 * @param {string} spec.id            node id; every telemetry sample names it
 * @param {number} spec.mass          kg. Required. Never defaulted.
 * @param {{x:number,y:number,z:number}} spec.inertia principal moments, kg*m^2
 */
export function createBody(spec) {
  const { id, mass, inertia } = spec;
  if (typeof id !== 'string' || !id.length) throw new TypeError('Rigid body requires an id.');
  if (!Number.isFinite(mass) || mass <= 0) {
    throw new TypeError(`Body '${id}' needs a declared mass in kg; a mass is never guessed.`);
  }
  for (const axis of WORLD_AXES) {
    if (!Number.isFinite(inertia?.[axis]) || inertia[axis] <= 0) {
      throw new TypeError(`Body '${id}' needs a positive declared inertia about ${axis}.`);
    }
  }
  return {
    id,
    kind: spec.kind ?? 'mech.body',
    mass,
    // Added mass multiplies the EFFECTIVE mass on a fluid-coupled axis. It is a declared,
    // tunable coefficient, never folded into the dry mass, so a report can say which is which.
    inertia: { ...inertia },
    position: spec.position ? { ...spec.position } : { ...ZERO },
    velocity: spec.velocity ? { ...spec.velocity } : { ...ZERO },
    orientation: spec.orientation ?? { x: 0, y: 0, z: 0, w: 1 },
    angularVelocity: spec.angularVelocity ? { ...spec.angularVelocity } : { ...ZERO },
    // Accumulated force/torque for the current step. Written by the fluid, aero and actuator
    // models, consumed by integrateStep.
    force: { ...ZERO },
    torque: { ...ZERO },
    addedMass: { x: 0, y: 0, z: 0 },
    submergedFraction: 0,
    warnings: [],
    linearDamping: Number.isFinite(spec.linear_damping) ? spec.linear_damping : 0,
    angularDamping: Number.isFinite(spec.angular_damping) ? spec.angular_damping : 0,
  };
}

/** Effective (dry + added) mass on one axis. */
export function effectiveMass(body, axis) {
  return body.mass * (1 + body.addedMass[axis]);
}

/**
 * One semi-implicit Euler step.
 *
 * Order is fixed and total over the accumulators, so the result does not depend on which
 * force model happened to run first. `dt` is the same for every body in the step.
 */
export function integrateStep(body, dt) {
  if (!(dt > 0)) throw new RangeError('Rigid body timestep must be positive.');

  const ax = body.force.x / effectiveMass(body, 'x');
  const ay = body.force.y / effectiveMass(body, 'y');
  const az = body.force.z / effectiveMass(body, 'z');

  body.velocity.x += ax * dt;
  body.velocity.y += ay * dt;
  body.velocity.z += az * dt;

  if (body.linearDamping > 0) {
    const decay = 1 / (1 + body.linearDamping * dt);
    body.velocity.x *= decay;
    body.velocity.y *= decay;
    body.velocity.z *= decay;
  }

  body.position.x += body.velocity.x * dt;
  body.position.y += body.velocity.y * dt;
  body.position.z += body.velocity.z * dt;

  const w = body.angularVelocity;
  const I = body.inertia;
  // Euler's rigid-body equations: I*w' = tau - w x (I*w). The gyroscopic term is included;
  // dropping it makes a spinning body precess the wrong way.
  const gyro = cross(w, { x: I.x * w.x, y: I.y * w.y, z: I.z * w.z });
  w.x += ((body.torque.x - gyro.x) / I.x) * dt;
  w.y += ((body.torque.y - gyro.y) / I.y) * dt;
  w.z += ((body.torque.z - gyro.z) / I.z) * dt;

  if (body.angularDamping > 0) {
    const decay = 1 / (1 + body.angularDamping * dt);
    w.x *= decay;
    w.y *= decay;
    w.z *= decay;
  }

  integrateOrientation(body, dt);

  body.force = { ...ZERO };
  body.torque = { ...ZERO };
}

/** Quaternion kinematics: q' = q + 0.5 * omega_quat * q, then renormalise. */
export function integrateOrientation(body, dt) {
  const q = body.orientation;
  const w = body.angularVelocity;
  const half = 0.5 * dt;
  const dq = {
    x: half * (w.x * q.w + w.y * q.z - w.z * q.y),
    y: half * (-w.x * q.z + w.y * q.w + w.z * q.x),
    z: half * (w.x * q.y - w.y * q.x + w.z * q.w),
    w: half * (-w.x * q.x - w.y * q.y - w.z * q.z),
  };
  q.x += dq.x;
  q.y += dq.y;
  q.z += dq.z;
  q.w += dq.w;
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  if (norm > 0) {
    q.x /= norm;
    q.y /= norm;
    q.z /= norm;
    q.w /= norm;
  }
}

/**
 * Displace a body point from body space into world space.
 * Only axis rotations matter for the models here; the full quaternion rotation is used so a
 * heeled hull's buoyancy sample points are genuinely heeled.
 */
export function rotate(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

/** World velocity of a body-fixed offset point, including the rotational term. */
export function pointVelocity(body, worldOffset) {
  return add(body.velocity, cross(body.angularVelocity, worldOffset));
}

export function cloneBody(body) {
  return {
    ...body,
    inertia: { ...body.inertia },
    position: { ...body.position },
    velocity: { ...body.velocity },
    angularVelocity: { ...body.angularVelocity },
    force: { ...body.force },
    torque: { ...body.torque },
    addedMass: { ...body.addedMass },
    orientation: { ...body.orientation },
    warnings: [...body.warnings],
  };
}

/** Rotate a world vector into body space. */
export function unrotate(q, v) {
  return rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}