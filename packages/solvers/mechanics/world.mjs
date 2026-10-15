/**
 * Build a simulated world from a contract-shaped graph, then step it.
 *
 * Determinism (I9): the timestep is fixed, the iteration order is the node order of the
 * graph, and no wall-clock, no Math.random and no hash iteration order reaches a force.
 * Same graph + same seed => byte-identical telemetry, and bench/cases/mechanics/determinism
 * proves it.
 *
 * Never guess a mass (brief §3.1): a body without a declared mass or a declared inertia
 * fails at build time with the offending node named.
 */

import {
  add, boxInertia, createBody, effectiveMass, integrateStep, scale, sphereInertia, vec,
} from './rigidbody.mjs';
import {
  STANDARD_GRAVITY, applyAddedMass, buoyancy, buoyancySamples, createWater, drag, froudeRegime,
  heaveDamping, hydrostaticStiffness, metacentricHeight,
} from './fluid.mjs';
import { airframeDrag, rotorForces, standardAtmosphere } from './aero.mjs';
import { ActuatorBus, applyTransfer, sensorReading } from './actuators.mjs';
import { withKindDefaults } from '../../core/graph/contracts.mjs';

export const DEFAULT_TIMESTEP = 1 / 240;
export const HARD_SUBSTEP_CAP = 64;

const AXES = ['x', 'y', 'z'];

/**
 * Build the world.
 *
 * @param {object} graph a validated v3 graph
 * @param {object} options { seed, timestep, duration_s, sample_rate_hz }
 */
export function buildWorld(graph, options = {}) {
  if (!graph || !Array.isArray(graph.nodes)) throw new TypeError('A graph with nodes is required.');
  // A node's effective properties are its kind's DECLARED defaults, overridden by whatever the
  // node declares. That keeps "never guess a mass" honest: the mass is declared, in
  // contracts/kinds.json, and visible to a reader. What is still refused is a property no kind
  // declares and no node supplies.
  const resolved = resolveKindDefaults(graph);
  const timestep = options.timestep ?? DEFAULT_TIMESTEP;
  if (!(timestep > 0)) throw new RangeError('Simulation timestep must be positive.');
  const seed = options.seed ?? 0;
  if (!Number.isInteger(seed)) throw new TypeError('A simulation requires an explicit integer seed.');

  const water = createWater(nodeProperty(resolved, 'env.water_body', 'water') ?? {});
  const airspace = buildAirspace(nodeProperty(resolved, 'env.airspace', 'airspace') ?? {});
  const ground = buildGround(nodeProperty(resolved, 'env.ground', 'ground') ?? {});

  const bodies = [];
  const byId = new Map();
  for (const node of resolved.nodes) {
    if (!BODY_KINDS.has(node.kind)) continue;
    const body = createBodyFromNode(node);
    const entry = { node, body, samples: null, drag: null, addedMass: null, regime: null, stability: null };
    bodies.push(entry);
    byId.set(node.id, entry);
  }

  const actuators = [];
  const sensors = [];
  const sources = [];
  for (const node of resolved.nodes) {
    if (ACTUATOR_KINDS.has(node.kind)) actuators.push(buildActuator(node, byId));
    else if (SENSOR_KINDS.has(node.kind)) sensors.push(buildSensor(node, byId));
    else if (SOURCE_KINDS.has(node.kind)) sources.push(buildSource(node));
  }

  const rotors = resolved.nodes.filter((node) => node.kind === 'mech.rotor')
    .map((node) => buildRotor(node, byId));
  const airframes = resolved.nodes.filter((node) => node.kind === 'mech.airframe')
    .map((node) => buildAirframe(node, byId));

  for (const entry of bodies) attachFluidModel(entry, graph);

  const world = {
    graph: resolved,
    seed,
    timestep,
    duration_s: options.duration_s ?? 20,
    sample_rate_hz: options.sample_rate_hz ?? 20,
    water,
    airspace,
    ground,
    bodies,
    byId,
    actuators,
    sensors,
    sources,
    rotors,
    airframes,
    bus: new ActuatorBus(),
    t: 0,
    step: 0,
    warnings: [],
    derived: {
      froude: null,
      gm_m: null,
      added_mass_ratio: null,
    },
  };
  validateCoupling(world);
  return world;
}

const BODY_KINDS = new Set(['mech.body', 'mech.hull', 'mech.float', 'mech.airframe']);
const ACTUATOR_KINDS = new Set(['actuator.thruster', 'actuator.servo', 'actuator.force']);
const SENSOR_KINDS = new Set(['mech.barometer', 'mech.imu', 'mech.depth_sensor', 'mech.compass']);
const SOURCE_KINDS = new Set(['mech.pwm_source', 'mech.control_law']);

function nodeProperty(resolved, kind, fallbackKey) {
  const node = resolved.nodes.find((entry) => entry.kind === kind);
  if (!node) return null;
  return { [fallbackKey]: true, ...(node.properties ?? {}) };
}

const DEFAULTS = new Map();

/**
 * Kind defaults, merged once per graph. Kept as a local helper so the mechanics world has no
 * import-time dependency on the contract loader; the merge itself lives in
 * `packages/core/graph/contracts.mjs` so every solver resolves declarations the same way.
 */
function resolveKindDefaults(graph) {
  return withKindDefaults(graph);
}

function createBodyFromNode(node) {
  const properties = node.properties ?? {};
  const mass = properties.mass_kg;
  const shape = properties.shape ?? 'box';
  let inertia;
  if (properties.inertia_kg_m2) {
    inertia = { ...properties.inertia_kg_m2 };
  } else if (Number.isFinite(properties.size_m)) {
    inertia = shape === 'sphere'
      ? sphereInertia(mass, properties.size_m)
      : boxInertia(mass, vec(properties.size_m, properties.size_m, properties.size_m));
  } else if (Number.isFinite(properties.length) || Number.isFinite(properties.length_m)) {
    const long = Number.isFinite(properties.length) ? properties.length : properties.length_m;
    const beamM = Number.isFinite(properties.beam) ? properties.beam
      : Number.isFinite(properties.beam_m) ? properties.beam_m : long;
    const depth = Number.isFinite(properties.draft) ? properties.draft
      : Number.isFinite(properties.draft_m) ? properties.draft_m : long;
    inertia = boxInertia(mass, vec(long, beamM, depth));
  } else if (Number.isFinite(properties.diameter_m)) {
    inertia = sphereInertia(mass, properties.diameter_m / 2);
  } else {
    inertia = { ...properties.inertia_kg_m2 };
  }
  const body = createBody({
    id: node.id,
    kind: node.kind,
    mass,
    inertia,
    position: properties.position ?? vec(),
    linear_damping: properties.linear_damping,
    angular_damping: properties.angular_damping,
  });
  return body;
}

function attachFluidModel(entry) {
  const properties = entry.node.properties ?? {};
  if (entry.node.kind === 'mech.hull' || entry.node.kind === 'mech.float') {
    entry.samples = buoyancySamples({ id: entry.node.id, ...properties });
  }
  if (properties.cd_surge !== undefined || properties.drag_areas_m2) {
    const areas = properties.drag_areas_m2 ?? {
      x: properties.cd_area_surge_m2,
      y: properties.cd_area_sway_m2,
      z: properties.cd_area_heave_m2,
    };
    const cd = {
      x: properties.cd_surge,
      y: properties.cd_sway,
      z: properties.cd_heave,
    };
    for (const axis of AXES) {
      if (!Number.isFinite(areas[axis]) || areas[axis] <= 0) {
        throw new TypeError(
          `Node '${entry.node.id}' declares fluid coupling but no drag area for ${axis}. ` +
          'A drag area is never guessed.',
        );
      }
      if (!Number.isFinite(cd[axis]) || cd[axis] <= 0) {
        throw new TypeError(
          `Node '${entry.node.id}' declares fluid coupling but no drag coefficient for ${axis}.`,
        );
      }
    }
    entry.drag = { cd, areas };
  }
  if (properties.added_mass) {
    entry.addedMass = { ...properties.added_mass };
    applyAddedMass(entry.body, entry.addedMass);
  }
  if (entry.node.kind === 'mech.hull' || entry.node.kind === 'mech.float') {
    entry.stability = metacentricHeight({
      volume: properties.volume,
      beam: properties.beam,
      draft: properties.draft,
      length: properties.length,
      water: { density: 1000 },
    });
    if (entry.stability && entry.stability.gm < 0) {
      entry.body.warnings.push(
        `metacentric height GM=${entry.stability.gm.toFixed(4)} m is negative: the trim is unstable.`,
      );
    }
  }
}

function buildActuator(node, byId) {
  const properties = node.properties ?? {};
  const target = properties.target_node ?? node.parent ?? node.parent_id;
  const entry = byId.get(target);
  if (!entry) {
    throw new TypeError(
      `Actuator '${node.id}' targets '${target ?? '(none)'}', which is not a simulated body.`,
    );
  }
  return {
    node,
    body: entry.body,
    channel: properties.channel ?? `${node.id}.signal`,
    transfer: properties.transfer,
    axis: properties.axis ?? 'x',
    mode: properties.mode ?? 'force',
  };
}

function buildSensor(node, byId) {
  const properties = node.properties ?? {};
  const target = properties.target_node ?? node.parent ?? node.parent_id;
  const entry = byId.get(target);
  if (!entry) {
    throw new TypeError(`Sensor '${node.id}' reads '${target ?? '(none)'}', which is not a simulated body.`);
  }
  const kind = properties.sensor ?? {
    'mech.barometer': 'barometer',
    'mech.imu': 'imu',
    'mech.depth_sensor': 'depth',
    'mech.compass': 'compass',
  }[node.kind];
  return {
    node,
    body: entry.body,
    kind,
    channel: properties.channel ?? `${node.id}.reading`,
    axis: properties.axis ?? 'z',
  };
}

function buildSource(node) {
  const properties = node.properties ?? {};
  if (node.kind === 'mech.pwm_source') {
    if (!Number.isFinite(properties.duty)) {
      throw new TypeError(`Node '${node.id}' is a PWM source and needs a declared duty cycle.`);
    }
    return { node, kind: 'pwm', channel: properties.channel ?? `${node.id}.pwm`, duty: properties.duty };
  }
  const required = ['setpoint', 'gain', 'source_channel', 'output_channel'];
  for (const key of required) {
    if (!Number.isFinite(properties[key]) && typeof properties[key] !== 'string') {
      throw new TypeError(`Control law '${node.id}' needs a declared '${key}'.`);
    }
  }
  return {
    node,
    kind: 'law',
    setpoint: properties.setpoint,
    gain: properties.gain,
    integral_gain: properties.integral_gain ?? 0,
    min: properties.min ?? 0,
    max: properties.max ?? 1,
    source_channel: properties.source_channel,
    output_channel: properties.output_channel,
    initial_output: Number.isFinite(properties.initial_output) ? properties.initial_output : 0,
    integral: 0,
  };
}

function buildRotor(node, byId) {
  const properties = node.properties ?? {};
  const target = properties.target_node ?? node.parent ?? node.parent_id;
  const entry = byId.get(target);
  if (!entry) throw new TypeError(`Rotor '${node.id}' is not attached to a simulated body.`);
  return {
    node,
    body: entry.body,
    rpm: properties.rpm ?? 0,
    direction: properties.direction ?? 1,
    blade_area_m2: properties.blade_area_m2,
    diameter_m: properties.diameter_m,
    thrust_coefficient: properties.thrust_coefficient,
    induced_drag_factor: properties.induced_drag_factor,
    max_rpm: properties.max_rpm,
    channel: properties.channel ?? null,
  };
}

function buildAirframe(node, byId) {
  const properties = node.properties ?? {};
  return {
    node,
    body: byId.get(node.id)?.body ?? null,
    cd: properties.cd ?? 1.0,
    area_m2: properties.area_m2,
  };
}

function buildAirspace(properties) {
  const atmosphere = standardAtmosphere(properties.altitude_m, properties.temperature_k);
  return {
    altitude_m: properties.altitude_m ?? 0,
    wind: { ...(properties.wind ?? vec()) },
    gust_model: properties.gust_model ?? 'steady',
    density: atmosphere.density,
    temperature_k: atmosphere.temperature_k,
    pressure_pa: atmosphere.pressure_pa,
    atmosphere_model: atmosphere.model,
    precipitation: properties.precipitation ?? 'none',
    seed: properties.seed ?? 0,
  };
}

function buildGround(properties) {
  return {
    height_m: properties.height_m ?? 0,
    friction: properties.friction ?? 0.6,
    restitution: properties.restitution ?? 0.1,
  };
}

function validateCoupling(world) {
  if (world.actuators.length === 0 && world.sensors.length === 0 && world.sources.length === 0) {
    return;
  }
  const channels = new Set([
    ...world.actuators.map((entry) => entry.channel),
    ...world.sensors.map((entry) => entry.channel),
    ...world.sources.map((entry) => (entry.kind === 'law' ? entry.output_channel : entry.channel)),
    ...world.sources.filter((entry) => entry.kind === 'law').map((entry) => entry.source_channel),
    ...world.rotors.map((entry) => entry.channel).filter(Boolean),
  ]);
  for (const actuator of world.actuators) {
    if (!channels.has(actuator.channel)) {
      throw new TypeError(
        `Actuator '${actuator.node.id}' reads channel '${actuator.channel}', which nothing produces. ` +
        'A force with no declared command source is never invented.',
      );
    }
  }
  for (const sensor of world.sensors) {
    if (!channels.has(sensor.channel)) {
      throw new TypeError(
        `Sensor '${sensor.node.id}' publishes channel '${sensor.channel}', which nothing reads.`,
      );
    }
  }
}

/** One fixed timestep over the whole world. Force accumulation order follows node order. */
export function stepWorld(world) {
  const dt = world.timestep;
  const density = world.water.density;

  for (const entry of world.bodies) {
    // Gravity is a body force, applied here so every model above only ever adds to it.
    // Omitting it is how a float silently becomes a balloon.
    entry.body.force.z -= entry.body.mass * STANDARD_GRAVITY;
    applyAddedMassIfDeclared(entry);
    if (entry.samples) applyBuoyancy(entry, world);
    if (entry.drag) applyDrag(entry, world);
  }

  for (const source of world.sources) stepSource(world, source, dt);
  for (const actuator of world.actuators) stepActuator(world, actuator, dt);
  for (const rotor of world.rotors) stepRotor(world, rotor);
  for (const airframe of world.airframes) stepAirframe(world, airframe);

  for (const entry of world.bodies) integrateStep(entry.body, dt);
  applyGroundContact(world);
  publishSensors(world, dt);

  world.t += dt;
  world.step += 1;
}

/**
 * Ground contact.
 *
 * Declared, Coulomb-free: penetration is clamped to the declared ground height and the
 * normal velocity is scaled by the declared restitution. Tangential velocity is scaled by
 * the declared friction. There is no contact manifold and no stacking, so a body resting on
 * another body falls through — declared unavailable, not approximated.
 */
function applyGroundContact(world) {
  const height = world.ground.height_m;
  for (const entry of world.bodies) {
    if (entry.node.properties?.ground_contact !== true) continue;
    const body = entry.body;
    if (body.position.z >= height) continue;
    body.position.z = height;
    if (body.velocity.z < 0) body.velocity.z = -body.velocity.z * world.ground.restitution;
    body.velocity.x *= world.ground.friction;
    body.velocity.y *= world.ground.friction;
  }
}

/**
 * Physics -> telemetry bus, the reverse direction of the coupling.
 *
 * Sensors publish AFTER integration so a control law reads the state produced by this
 * step, not the state it is about to correct. The one-step delay is the sample period and
 * is stated rather than hidden.
 */
function publishSensors(world) {
  for (const sensor of world.sensors) {
    const reading = sensorReading(sensor.kind, sensor.body, {
      surface_z: world.water.surface_z,
      ground_z: world.ground.height_m,
      density: world.water.density,
      gravity: STANDARD_GRAVITY,
      datum: sensor.node.properties?.datum_m,
    });
    sensor.last = reading;
    world.bus.command(sensor.channel, {
      signal: reading.value,
      source: sensor.node.id,
      t: world.t,
    });
  }
}

function applyAddedMassIfDeclared(entry) {
  if (entry.addedMass) applyAddedMass(entry.body, entry.addedMass);
}

function applyBuoyancy(entry, world) {
  const result = buoyancy(entry.body, entry.samples, world.water);
  entry.body.force = add(entry.body.force, result.force);
  entry.body.submergedFraction = result.submerged_volume;
  // GM is an at-rest hydrostatic check on the declared geometry, not a per-step quantity.
  // It is computed once at build time and reported as a constant diagnostic.
  const damping = heaveDamping(entry.body, world.water, entry.node.properties?.heave_damping);
  entry.body.force = add(entry.body.force, damping);
}

function applyDrag(entry, world) {
  const result = drag(entry.body, world.water, entry.drag);
  let force = result.force;
  const properties = entry.node.properties ?? {};
  if (Number.isFinite(properties.waterline_length_m) && entry.node.kind === 'mech.hull') {
    const regime = froudeRegime(result.per_axis.x, properties.waterline_length_m, {
      planing_threshold: properties.planing_threshold ?? 0.4,
      planing_drag_factor: properties.planing_drag_factor ?? 1.35,
    });
    entry.regime = regime;
    force = scale(force, regime.drag_multiplier);
  }
  entry.body.force = add(entry.body.force, force);
  entry.drag_n = lengthOf(force);
}

function stepSource(world, source, dt) {
  if (source.kind === 'pwm') {
    world.bus.command(source.channel, {
      signal: clamp01(source.duty),
      source: source.node.id,
      t: world.t,
    });
    return;
  }
  const reading = world.bus.read(source.source_channel);
  if (!reading) {
    // Cold start: no sensor has published yet. The law emits its DECLARED initial output
    // until the first reading arrives. A default of zero would be a guess; a declared value
    // is a choice the report can show.
    world.bus.command(source.output_channel, {
      signal: source.initial_output,
      source: `${source.node.id}:cold_start`,
      t: world.t,
    });
    return;
  }
  const error = source.setpoint - reading.signal;
  source.integral += error * dt;
  const raw = source.gain * error + source.integral_gain * source.integral;
  const command = Math.min(source.max, Math.max(source.min, raw));
  world.bus.command(source.output_channel, {
    signal: command,
    source: source.node.id,
    t: world.t,
  });
}

function stepActuator(world, actuator) {
  const reading = world.bus.read(actuator.channel);
  if (!reading) {
    throw Object.assign(
      new Error(`Actuator '${actuator.node.id}' has no signal on '${actuator.channel}'.`),
      { code: 'ACTUATOR_NO_SIGNAL' },
    );
  }
  const transfer = applyTransfer(reading.signal, actuator.transfer);
  actuator.last = { ...transfer, signal: reading.signal, t: world.t, source: reading.source };
  const axis = actuator.axis;
  if (actuator.mode === 'torque') {
    actuator.body.torque[axis] += transfer.output;
  } else {
    actuator.body.force[axis] += transfer.output;
  }
}

function stepRotor(world, rotor) {
  const density = world.airspace.density;
  const rpm = rotor.channel ? signalRpm(world, rotor) : rotor.rpm;
  const forces = rotorForces(rotor, rpm, density);
  rotor.last = forces;
  if (!rotor.body) return;
  rotor.body.force = add(rotor.body.force, vec(
    0, 0, forces.thrust_n * rotor.direction,
  ));
  rotor.body.torque = add(rotor.body.torque, vec(0, 0, -forces.thrust_n * rotor.direction));
}

/**
 * A rotor driven by a signal channel instead of a fixed declared RPM.
 *
 * This is the drone half of the pin-to-force bridge: the same normalised signal an ESC
 * takes drives `max_rpm`. The mapping is linear and declared, and it is the ONLY way a rotor
 * speed changes during a run — a rotor never accelerates toward a target on its own.
 */
function signalRpm(world, rotor) {
  const reading = world.bus.read(rotor.channel);
  if (!reading) {
    throw Object.assign(
      new Error(`Rotor '${rotor.node.id}' reads channel '${rotor.channel}', which nothing produces.`),
      { code: 'ROTOR_NO_SIGNAL' },
    );
  }
  const maxRpm = Number.isFinite(rotor.max_rpm) && rotor.max_rpm > 0 ? rotor.max_rpm : 0;
  if (maxRpm <= 0) {
    throw new TypeError(`Rotor '${rotor.node.id}' drives from a signal and needs a declared max_rpm.`);
  }
  return clamp01(reading.signal) * maxRpm;
}

function stepAirframe(world, airframe) {
  if (!airframe.body) return;
  const result = airframeDrag(airframe.body.velocity, world.airspace.wind, world.airspace.density,
    airframe.cd, airframe.area_m2);
  airframe.last = result;
  airframe.body.force = add(airframe.body.force, result.force);
}

/** Sample every channel the world publishes. Called at the declared sample rate. */
export function sampleWorld(world, projectId) {
  const samples = [];
  const push = (node, channel, value, unit, quality, extra) => {
    if (!Number.isFinite(value)) return;
    samples.push({
      project_id: projectId,
      t: round(world.t),
      node,
      channel,
      value,
      unit,
      quality: quality ?? 'measured',
      solver: node === 'environment' ? 'environment' : 'mechanics',
      ...(extra ?? {}),
    });
  };

  for (const entry of world.bodies) {
    const id = entry.body.id;
    push(id, 'body.position.x', entry.body.position.x, 'm');
    push(id, 'body.position.y', entry.body.position.y, 'm');
    push(id, 'body.position.z', entry.body.position.z, 'm');
    push(id, 'body.velocity.x', entry.body.velocity.x, 'm/s');
    push(id, 'body.velocity.y', entry.body.velocity.y, 'm/s');
    push(id, 'body.velocity.z', entry.body.velocity.z, 'm/s');
    push(id, 'body.speed_mps', lengthOf(entry.body.velocity), 'm/s', 'derived', {
      source: { method: 'body.speed_mps', model: 'euclidean norm of body.velocity' },
    });
  }

  for (const entry of world.bodies) {
    if (!entry.samples) continue;
    const properties = entry.node.properties ?? {};
    const id = entry.body.id;
    push(id, 'hull.speed_surge_mps', entry.body.velocity.x, 'm/s');
    push(id, 'hull.draft_m', world.water.surface_z - entry.body.position.z, 'm');
    push(id, 'hull.displaced_m3', entry.body.submergedFraction, 'm^3', 'derived', {
      source: { method: 'hull.displaced_m3', model: 'sum of submerged declared sample volumes' },
    });
    if (Number.isFinite(properties.cd_surge)) {
      push(id, 'hull.drag_force_n', entry.drag_n ?? 0, 'N', 'derived', {
        source: { method: 'hull.drag_force_n', model: 'quadratic drag, declared Cd and area' },
      });
    }
    if (entry.regime) {
      push(id, 'hull.froude', entry.regime.froude, '-', 'derived', {
        source: { method: 'hull.froude', model: 'v/sqrt(g*L)' },
      });
    }
    if (entry.stability) {
      push(id, 'hull.gm_m', entry.stability.gm, 'm', 'derived', {
        source: { method: 'hull.gm_m', model: 'KB + BM - KG' },
      });
    }
    if (entry.addedMass) {
      push(id, 'hull.added_mass_ratio', entry.addedMass.x, '-', 'derived', {
        source: { method: 'hull.added_mass_ratio', model: 'declared Ca on the surge axis' },
      });
    }
  }

  for (const actuator of world.actuators) {
    if (!actuator.last) continue;
    push(actuator.node.id, 'actuator.signal', actuator.last.signal, 'ratio');
    push(actuator.node.id, actuator.mode === 'torque' ? 'actuator.torque_nm' : 'thruster.thrust_n',
      actuator.last.output, actuator.mode === 'torque' ? 'N*m' : 'N', 'derived', {
        source: { method: 'actuator.transfer', model: actuator.node.properties?.transfer?.curve ?? 'linear' },
      });
  }

  for (const rotor of world.rotors) {
    if (!rotor.last) continue;
    push(rotor.node.id, 'rotor.rpm', rotor.last.rpm, 'rpm');
    push(rotor.node.id, 'rotor.thrust_n', rotor.last.thrust_n, 'N', 'derived', {
      source: { method: 'rotor.thrust_n', model: 'Ct*rho*A*v_tip^2' },
    });
  }

  for (const source of world.sources) {
    const channel = source.kind === 'law' ? source.output_channel : source.channel;
    const reading = world.bus.read(channel);
    if (!reading) continue;
    push(source.node.id, 'pwm.duty', reading.signal, 'ratio');
  }

  for (const sensor of world.sensors) {
    const reading = sensorReading(sensor.kind, sensor.body, {
      surface_z: world.water.surface_z,
      ground_z: world.ground.height_m,
      density: world.water.density,
      gravity: STANDARD_GRAVITY,
      datum: sensor.node.properties?.datum_m,
    });
    push(sensor.node.id, sensor.channel, reading.value, reading.unit, reading.quality, {
      source: { method: sensor.kind, model: reading.model },
    });
  }

  for (const airframe of world.airframes) {
    if (!airframe.last) continue;
    push(airframe.node.id, 'airframe.drag_n', lengthOf(airframe.last.force), 'N', 'derived', {
      source: { method: 'airframe.drag_n', model: '0.5*rho*Cd*A*|v_rel|*v_rel in the wind frame' },
    });
    push(airframe.node.id, 'airframe.wind_speed_mps', lengthOf(world.airspace.wind), 'm/s');
  }

  push('environment', 'env.wave_height_m', waveHeightAt(world.water, world.t), 'm', 'measured', {
    source: { method: world.water.wave_model, model: world.water.wave_model },
  });
  push('environment', 'env.water_density_kg_m3', world.water.density, 'kg/m^3', 'measured', {
    source: { method: 'env.water_body', model: 'declared water body density' },
  });
  push('environment', 'env.wind_speed_mps', lengthOf(world.airspace.wind), 'm/s', 'measured', {
    source: { method: 'env.airspace', model: world.airspace.gust_model },
  });
  push('environment', 'env.air_density_kg_m3', world.airspace.density, 'kg/m^3', 'derived', {
    source: { method: world.airspace.atmosphere_model, model: 'ISA troposphere' },
  });
  return samples;
}

/**
 * Wave surface height. `flat` is the default and returns the declared surface. A seeded
 * multi-sinusoid model is available and its parameters are declared, so a run is
 * reproducible; it is NOT a spectrum model and is documented as such.
 */
export function waveHeightAt(water, t) {
  if (water.wave_model === 'flat') return water.surface_z;
  if (water.wave_model !== 'seeded_sinusoid') {
    throw Object.assign(new Error(`Unknown wave model '${water.wave_model}'.`), { code: 'WAVE_MODEL_UNKNOWN' });
  }
  const components = water.wave_parameters.components ?? [];
  let height = water.surface_z;
  for (const component of components) {
    height += component.amplitude_m * Math.sin(2 * Math.PI * component.frequency_hz * t + (component.phase_rad ?? 0));
  }
  return height;
}

export { STANDARD_GRAVITY, effectiveMass, hydrostaticStiffness };

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round(value) {
  return Math.round(value * 1e9) / 1e9;
}

function lengthOf(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}