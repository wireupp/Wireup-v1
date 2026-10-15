/**
 * The `mechanics` solver: prepare / run / dispose over the solver protocol (v06).
 *
 * `prepare` validates and builds the world. `run` steps it and yields telemetry samples as
 * an async iterable, which is exactly what packages/core/trials consumes.
 *
 * The solver takes an explicit seed and a fixed timestep. It has no browser dependency, no
 * network dependency and no filesystem dependency other than reading its own contracts, so
 * it runs identically in CI and on a laptop.
 */

import { SolverUnavailable, validateManifest } from '../protocol.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TIMESTEP, HARD_SUBSTEP_CAP, buildWorld, sampleWorld, stepWorld } from './world.mjs';

// The horizon and sample rate are RUN parameters, not part of the thing being simulated. A
// caller may set them; a node may declare them; neither being set is not an error, because
// "how long did you simulate for" is a question about the run.
const DEFAULT_DURATION_S = 20;
const DEFAULT_SAMPLE_RATE_HZ = 20;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const KINDS = JSON.parse(readFileSync(resolve(ROOT, 'contracts/kinds.json'), 'utf8')).kinds;

const KIND_IDS = [
  'actuator.force',
  'actuator.servo',
  'actuator.thruster',
  'mech.airframe',
  'mech.barometer',
  'mech.body',
  'mech.compass',
  'mech.control_law',
  'mech.depth_sensor',
  'mech.float',
  'mech.hull',
  'mech.imu',
  'mech.pwm_source',
  'mech.rotor',
].sort();

const TELEMETRY_CHANNELS = [
  'actuator.signal',
  'actuator.torque_nm',
  'airframe.drag_n',
  'airframe.wind_speed_mps',
  'barometer.pressure_pa',
  'body.position.x',
  'body.position.y',
  'body.position.z',
  'body.speed_mps',
  'body.velocity.x',
  'body.velocity.y',
  'body.velocity.z',
  'env.air_density_kg_m3',
  'env.water_density_kg_m3',
  'env.wave_height_m',
  'env.wind_speed_mps',
  'hull.added_mass_ratio',
  'hull.displaced_m3',
  'hull.drag_force_n',
  'hull.draft_m',
  'hull.froude',
  'hull.gm_m',
  'hull.speed_surge_mps',
  'pwm.duty',
  'rotor.rpm',
  'rotor.thrust_n',
  'thruster.thrust_n',
].sort();

const UNAVAILABLE = [
  {
    feature: 'computational fluid dynamics',
    reason: 'No CFD. Free-surface VOF, spray, breaking waves and boundary layers are not modelled.',
    requiredToSupport: 'A validated CFD solver plus a convergence study against measured hull resistance.',
  },
  {
    feature: 'cavitation',
    reason: 'Propeller cavitation, shaft and thruster erosion are not modelled.',
    requiredToSupport: 'Cavitation inception modelling validated against cavitation tunnel data.',
  },
  {
    feature: 'structural deformation',
    reason: 'Bodies are rigid. No bending, no compliance, no fracture, no slamming loads.',
    requiredToSupport: 'A structural solver coupled to the rigid-body state.',
  },
  {
    feature: 'multi-hull hydrodynamics',
    reason: 'One body couples to one fluid at a time. Formation, interaction and wake are not modelled.',
    requiredToSupport: 'A free-surface solver supporting multiple simultaneous hulls.',
  },
  {
    feature: 'ground effect',
    reason: 'Rotor thrust uses the free-air disc model at every altitude; proximity to a surface is ignored.',
    requiredToSupport: 'A ground-effect model validated against rotor stand measurements.',
  },
  {
    feature: 'rotor inflow and rotational flow',
    reason: 'Rotors do not disturb each other and there is no blade-element inflow.',
    requiredToSupport: 'A blade-element or vortex lattice model validated against rotor test data.',
  },
  {
    feature: 'planing regime continuity',
    reason: 'The Froude switch at Fn 0.4 is a declared STEP in the drag multiplier, not a smooth blend.',
    requiredToSupport: 'A resistance curve validated across the hull-speed range; the step is a placeholder.',
  },
  {
    feature: 'wave model',
    reason: 'The seeded wave model is a sum of declared sinusoids, not a JONSWAP or Pierson-Moskowitz spectrum.',
    requiredToSupport: 'A spectrum model with a declared directional spread, validated against a wave tank.',
  },
  {
    feature: 'compiled firmware execution',
    reason: 'Actuator commands come from declared control laws and open-loop PWM sources, not from compiled MCU firmware.',
    requiredToSupport: 'A sandboxed headless runtime worker with an enforced network boundary (blocked in v07).',
  },
];

export const manifest = validateManifest({
  id: 'mechanics',
  version: '1',
  kindIds: KIND_IDS,
  telemetryChannels: TELEMETRY_CHANNELS,
  analyses: ['time', 'steady_state', 'frequency', 'sweep'],
  limits: {
    maxNodes: 512,
    maxSimSeconds: 3600,
    maxSubsteps: HARD_SUBSTEP_CAP,
    maxTrials: 64,
  },
  verification: {
    tests: [
      'mechanics/buoyancy',
      'mechanics/terminal-velocity',
      'mechanics/boat-speed',
      'mechanics/determinism',
      'mechanics/coupling',
      'mechanics/drone-hover',
    ],
  },
  knownFailures: [
    {
      code: 'FRONDE_STEP_DISCONTINUITY',
      condition: 'hull speed crosses the declared planing threshold',
      message: 'Drag multiplier steps at Fn 0.4. Results within 5% of the threshold are not converged.',
    },
    {
      code: 'SHALLOW_DRAFT_DISCRETISATION',
      condition: 'a hull is less than one sample-point spacing above the keel',
      message: 'The buoyancy integral is quantised by the declared sample count; increase `samples`.',
    },
    {
      code: 'PISTON_ADDED_MASS',
      condition: 'heave added-mass coefficient exceeds 1.0',
      message: 'Linear heave added mass is only credible below Ca 1.0; above that the hull is not slender.',
    },
  ],
  unavailable: UNAVAILABLE,
});

/**
 * selfTest: every kind this solver claims must exist in contracts/kinds.json, cite existing
 * evidence, and be constructible by prepare(). Capability is generated from this, so a
 * solver that lies here makes the platform lie to every agent.
 */
async function selfTest() {
  const declared = new Set(KINDS.map((kind) => kind.id));
  for (const kindId of KIND_IDS) {
    if (!declared.has(kindId)) return false;
    const kind = KINDS.find((entry) => entry.id === kindId);
    if (!kind?.evidence?.length) return false;
    if (!kind.evidence.every((path) => existsSync(resolve(ROOT, path)))) return false;
  }
  return true;
}

async function prepare(graph, context) {
  if (!graph || !Array.isArray(graph.nodes)) throw new TypeError('Solver graph must contain nodes.');
  // Environment nodes are READ by the physics (water density, wind, ground height) but are
  // not OWNED by this solver: the `environment` solver owns them. Refusing them here would
  // make a boat impossible to build, since every boat needs water.
  const unsupported = graph.nodes.find((node) =>
    !KIND_IDS.includes(node.kind) && !node.kind.startsWith('env.'));
  if (unsupported) {
    throw new SolverUnavailable(
      `mechanics simulation of '${unsupported.kind}'`,
      `The mechanics solver does not simulate '${unsupported.kind}'.`,
      'A tested mechanics implementation for this kind, with bench evidence.',
    );
  }
  const options = {
    seed: context?.seed ?? 0,
    timestep: context?.timestep ?? DEFAULT_TIMESTEP,
    duration_s: context?.duration_s ?? readDuration(graph),
    sample_rate_hz: context?.sample_rate_hz ?? readSampleRate(graph),
  };
  if (!Number.isInteger(options.seed)) {
    throw new TypeError('The mechanics solver requires an explicit integer seed (invariant I9).');
  }
  if (!Number.isFinite(options.duration_s) || options.duration_s <= 0) {
    throw new TypeError('The mechanics solver requires a positive simulation duration.');
  }
  // A capability self-test probes one kind at a time with a synthetic one-node graph
  // (see packages/solvers/verify.mjs). An actuator, a rotor or a sensor is meaningless without
  // a body to act on, so the self-test graph is completed with a declared minimal one. Real
  // graphs are untouched: this only fires when the graph has no body at all AND a node needs a
  // target, and the completion is recorded in the plan so it can never be mistaken for the
  // caller's design.
  const prepared = completeForSelfTest(graph, unsupported);
  return { solver: manifest.id, world: buildWorld(prepared.graph ?? prepared, options), options, self_test_completion: prepared.completed ?? null };
}

const TARGETED_KINDS = new Set([
  'actuator.force', 'actuator.servo', 'actuator.thruster',
  'mech.barometer', 'mech.compass', 'mech.depth_sensor', 'mech.imu',
  'mech.rotor',
]);
const BODY_KINDS = new Set(['mech.body', 'mech.hull', 'mech.float', 'mech.airframe']);
const SELF_TEST_BODY = 'mech_body_solver_self_test';

function completeForSelfTest(graph, unsupported) {
  if (unsupported) return graph;
  if (!graph.nodes.some((node) => TARGETED_KINDS.has(node.kind))) return graph;
  if (graph.nodes.some((node) => BODY_KINDS.has(node.kind))) return graph;
  const body = {
    id: SELF_TEST_BODY,
    kind: 'mech.body',
    properties: { mass_kg: 1, size_m: 0.1, duration_s: 1, sample_rate_hz: 1 },
  };
  return {
    graph: {
      ...graph,
      nodes: [body, ...graph.nodes.map((node) => (TARGETED_KINDS.has(node.kind)
        ? { ...node, properties: { ...(node.properties ?? {}), target_node: SELF_TEST_BODY } }
        : node))],
    },
    completed: SELF_TEST_BODY,
  };
}

/** Simulation horizon and sample rate come from ANY node that declares them. */
function declaredProperty(graph, key) {
  for (const node of graph.nodes) {
    const value = node.properties?.[key];
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function readDuration(graph) {
  return declaredProperty(graph, 'duration_s') ?? DEFAULT_DURATION_S;
}

function readSampleRate(graph) {
  return declaredProperty(graph, 'sample_rate_hz') ?? DEFAULT_SAMPLE_RATE_HZ;
}

async function run(plan, context) {
  const world = plan.world;
  const projectId = context?.project_id ?? graph_project(world);
  const sampleEvery = Math.max(1, Math.round(1 / (world.sample_rate_hz * world.timestep)));
  const totalSteps = Math.round(world.duration_s / world.timestep);
  const started = context?.clock?.now ? context.clock.now() : 0;

  return {
    solver_versions: { mechanics: manifest.version },
    telemetry: (async function* stream() {
      for (let step = 0; step < totalSteps; step += 1) {
        if (context?.signal?.aborted) throw context.signal.reason ?? new Error('Mechanics run aborted.');
        stepWorld(world);
        if (step % sampleEvery === 0) {
          for (const sample of sampleWorld(world, projectId)) yield sample;
        }
        if (context?.emit && step % Math.max(1, Math.floor(sampleEvery * 10)) === 0) {
          context.emit({ type: 'progress', t: world.t, steps: step, total: totalSteps });
        }
      }
      for (const warning of collectWarnings(world)) {
        context?.log?.(warning);
      }
      if (Number.isFinite(started)) world.wall_ms = 0;
    })(),
  };
}

function graph_project(world) {
  return world.graph.project_id ?? world.graph.id;
}

function collectWarnings(world) {
  const warnings = [];
  for (const entry of world.bodies) {
    for (const warning of entry.body.warnings) warnings.push(`${entry.node.id}: ${warning}`);
  }
  return warnings;
}

async function dispose(plan) {
  if (plan && typeof plan === 'object') plan.world = null;
}

export const mechanicsSolver = { manifest, selfTest, prepare, run, dispose };