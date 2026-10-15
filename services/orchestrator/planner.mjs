/**
 * Planning, phase v09.
 *
 * The plan is SCHEMA-DRIVEN AND DETERMINISTIC. Kind selection, step ordering and parameter
 * choice are decided here from the parsed goal and the generated capability document — never by
 * a language model. A model, if one is configured, may write firmware and explain failures; it
 * does not decide what to build. That is the right trade: a deterministic loop with a model in
 * the firmware seat is far more reliable than a model planning everything.
 *
 * Two rules the plan must never break:
 *   1. Every required kind exists in contracts/kinds.json. A kind that is not simulated is
 *      allowed only with an explicit `risks[].blocking` entry, which propagates to the report.
 *   2. The plan is REPLAYED against the graph rules before a single node is added. An invalid
 *      plan never starts.
 */

import { GraphStore } from '../../packages/core/graph/store.mjs';
import { withKindDefaults } from '../../packages/core/graph/contracts.mjs';

export const LANES = Object.freeze({
  mechanics: 'mechanics',
  software: 'software',
  electronics: null,
});

/**
 * The node templates per domain.
 *
 * These are the smallest graphs that can produce the channel a goal metric names. They are
 * templates, not fixtures: the executor sets the parameters the goal actually asked for.
 */
const DEFAULT_PAGE = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
  + '<title>WireUp</title></head><body><h1>WireUp</h1><p id="status">served</p></body></html>';

const SKELETONS = {
  mechanics: {
    lane: 'mechanics',
    nodes: [
      { id: 'env_water_body_00000001', kind: 'env.water_body', properties: { surface_z: 0, density: 1000, wave_model: 'flat' } },
      { id: 'env_airspace_00000002', kind: 'env.airspace', properties: { altitude_m: 0, wind: { x: 0, y: 0, z: 0 } } },
      { id: 'env_ground_00000003', kind: 'env.ground', properties: { height_m: 0, friction: 0.6, restitution: 0.1 } },
      {
        id: 'mech_hull_00000004',
        kind: 'mech.hull',
        properties: {
          mass_kg: 12, volume: 0.02, length: 0.9, beam: 0.24, draft: 0.12,
          cd_surge: 0.006, cd_sway: 0.45, cd_heave: 0.9,
          cd_area_surge_m2: 0.216, cd_area_sway_m2: 1.08, cd_area_heave_m2: 1.08,
          waterline_length_m: 0.9, planing_threshold: 0.6, heave_damping: 500,
          added_mass: { x: 0.1, y: 0.8, z: 1.0 }, duration_s: 90, sample_rate_hz: 10,
          position: { x: 0, y: 0, z: -0.03 },
        },
      },
      { id: 'mech_pwm_source_00000005', kind: 'mech.pwm_source', properties: { duty: 0.1, channel: 'esc.pwm' } },
      {
        id: 'actuator_thruster_00000006',
        kind: 'actuator.thruster',
        properties: {
          target_node: 'mech_hull_00000004', channel: 'esc.pwm', axis: 'x', mode: 'force',
          transfer: { curve: 'linear', deadband: 0.05, saturation: 0.95, gain: 12 },
        },
      },
      {
        id: 'actuator_thruster_00000007',
        kind: 'actuator.thruster',
        properties: {
          target_node: 'mech_hull_00000004', channel: 'esc.pwm', axis: 'x', mode: 'force',
          transfer: { curve: 'linear', deadband: 0.05, saturation: 0.95, gain: 12 },
        },
      },
    ],
    edges: [
      {
        id: 'wire_pwm_00000008',
        kind: 'signal.pwm',
        from: { node: 'mech_pwm_source_00000005', port: 'pwm' },
        to: { node: 'actuator_thruster_00000006', port: 'pwm' },
      },
      {
        id: 'wire_force_00000009',
        kind: 'mech.force',
        from: { node: 'actuator_thruster_00000006', port: 'force' },
        to: { node: 'mech_hull_00000004', port: 'thrust' },
      },
    ],
    parameter_node: 'mech_pwm_source_00000005',
    parameter_property: 'duty',
  },
  software: {
    lane: 'software',
    nodes: [
      { id: 'software_computer_00000010', kind: 'software.computer', properties: { memory_mb: 8192, cores: 4, os: 'linux' } },
      {
        id: 'software_web_app_00000011',
        kind: 'software.web_app',
        parent_id: 'software_computer_00000010',
        properties: {
          entry: 'index.html',
          framework: 'vanilla',
          files: {
            'index.html': DEFAULT_PAGE,
          },
          dom_operations: [
            { id: 'title', op: 'title', expression: 'value', expect: { op: 'ne', value: '' } },
            { id: 'body', op: 'exists', selector: 'body', expression: 'value', expect: { op: 'eq', value: true } },
          ],
        },
      },
    ],
    edges: [],
    parameter_node: 'software_web_app_00000011',
    parameter_property: null,
  },
};

/**
 * Things a goal can require that are NOT parts.
 *
 * These are capabilities rather than kinds: a solar-powered boat needs a light model, a
 * submarine needs a pressure-rated hull model, and a page that calls a corporate API needs a
 * sandbox egress policy. None of those kinds exists in contracts/kinds.json, and that is the
 * point: the planner must be able to say "this needs something I do not have" in a sentence
 * that names the missing thing, rather than building a boat with no sun and calling it done.
 */
const CAPABILITY_REQUIREMENTS = [
  { pattern: /\bsolar|sunlight|sun\b/i, kind: 'env.sunlight', requires: 'A declared solar irradiance model with a time-of-day cycle.' },
  { pattern: /\bsubmarine\b/i, kind: 'env.pressure_hull', requires: 'A pressure-rated hull model with a collapse depth, validated against pressure-test data.' },
  { pattern: /\bcorporate api\b|\bapi at\b|\begress\b/i, kind: 'net.egress_policy', requires: 'A sandbox network egress policy; the solver refuses any app that declares deny_internet:false.' },
  { pattern: /\bbluetooth\b|\bwifi\b|\bwireless\b/i, kind: 'net.radio', requires: 'A declared radio transport and a sandbox egress policy for it.' },
  { pattern: /\bfirmware\b|\bfirmware\b/i, kind: 'mech.compiled_firmware', requires: 'A sandboxed headless runtime worker with an OS-enforced network boundary (blocked in v07).' },
];

function unmetCapabilityRequirements(goal, declaredKinds) {
  return CAPABILITY_REQUIREMENTS.filter((requirement) => requirement.pattern.test(goal.raw))
    .filter((requirement) => !declaredKinds.has(requirement.kind))
    .map((requirement) => ({
      description: `The goal requires '${requirement.kind}', which contracts/kinds.json does not declare.`,
      mitigation: requirement.requires,
      blocking: true,
    }));
}

/**
 * Build a plan.
 * @param {object} capability the generated capability document
 */
export function planGoal(goal, capability) {
  const risks = [];
  const laneKey = goal.domain === 'hybrid' ? 'mechanics' : goal.domain;
  const lane = LANES[laneKey] ?? null;
  const declaredIds = new Set((capability.kinds ?? []).map((kind) => kind.id));
  risks.push(...unmetCapabilityRequirements(goal, declaredIds));
  const capabilityBlocker = risks.find((risk) => risk.blocking);

  if (!lane) {
    return {
      domain: goal.domain,
      lane: null,
      required_kinds: [],
      metrics: goal.metrics,
      trial_design: { parameters: [], repeats: 1, seed_policy: 'deterministic' },
      build_steps: [],
      risks,
      infeasible: {
        reason: `No headless execution lane exists for '${goal.domain}' projects. ` +
          'Firmware can only be compiled and run in a connected browser, and this orchestrator runs headless.',
        required_to_support: 'A sandboxed headless runtime worker with an OS-enforced network boundary ' +
          '(packages/solvers/mcu manifest: compiled firmware execution is unavailable).',
      },
    };
  }

  const skeleton = SKELETONS[laneKey];
  const requiredKinds = [...new Set(skeleton.nodes.map((node) => node.kind))].sort();
  const declaredKinds = new Map(capability.kinds.map((kind) => [kind.id, kind]));

  for (const kindId of requiredKinds) {
    const declared = declaredKinds.get(kindId);
    if (!declared) {
      risks.push({
        description: `Kind '${kindId}' is not in contracts/kinds.json.`,
        mitigation: 'The plan is refused before any mutation.',
        blocking: true,
      });
      continue;
    }
    if (!declared.simulated) {
      risks.push({
        description: `Kind '${kindId}' is declared but not simulated.`,
        mitigation: `Add this part as placement-only; no behaviour will be claimed for it. Required to support: ` +
          `${declared.solver ? `a passing solver for ${declared.solver}` : 'a registered solver'}.`,
        blocking: false,
      });
    }
  }

  const blocking = risks.filter((risk) => risk.blocking);
  if (capabilityBlocker) {
    return {
      domain: goal.domain,
      lane,
      required_kinds: [],
      metrics: goal.metrics,
      trial_design: { parameters: [], repeats: 1, seed_policy: 'deterministic' },
      build_steps: [],
      risks,
      infeasible: {
        reason: capabilityBlocker.description,
        required_to_support: capabilityBlocker.mitigation,
      },
    };
  }
  const parameters = laneKey === 'mechanics'
    ? [{
      node: skeleton.parameter_node,
      property: skeleton.parameter_property,
      // The duty cycle is the one free knob that trades speed against everything else. The
      // search range is derived from the goal's own target, never guessed independently.
      values: dutyRange(goal),
    }]
    : [];

  const plan = {
    domain: goal.domain,
    lane,
    required_kinds: requiredKinds.map((kind) => ({
      kind,
      quantity: skeleton.nodes.filter((node) => node.kind === kind).length,
      purpose: purposeFor(kind),
    })),
    metrics: goal.metrics,
    trial_design: { parameters, repeats: 1, seed_policy: 'deterministic' },
    build_steps: skeleton.nodes.map((node) => ({
      tool: 'node.add',
      args_summary: `${node.kind} ${node.id}`,
      depends_on: [],
    })).concat(skeleton.edges.map((edge) => ({
      tool: 'edge.connect',
      args_summary: `${edge.from.node}.${edge.from.port} -> ${edge.to.node}.${edge.to.port}`,
      depends_on: [edge.from.node, edge.to.node],
    }))),
    risks,
    skeleton,
  };

  const replay = replayPlan(plan, goal);
  if (replay.issues.length) {
    return {
      ...plan,
      infeasible: {
        reason: `The plan does not satisfy the graph rules: ${replay.issues.map((i) => i.message).join('; ')}`,
        required_to_support: 'A plan that validates against packages/core/graph/rules.mjs.',
      },
    };
  }
  if (blocking.length) {
    return { ...plan, infeasible: { reason: blocking[0].description, required_to_support: blocking[0].mitigation } };
  }
  return plan;
}

function dutyRange(goal) {
  const metric = goal.metrics[0];
  // A first guess from the physics the plan itself declares, then a bracket around it so the
  // loop can search. The bracket is wide because a wrong guess is cheap: each point is one
  // deterministic run.
  const hullGain = 12;
  const deadband = 0.05;
  const stiffness = 0.5 * 1000 * 0.006 * 0.216;
  const target = Number.isFinite(metric?.target) ? Math.abs(metric.target) : 1;
  const needed = target ** 2 * stiffness / (2 * hullGain);
  const centre = Math.min(0.9, Math.max(0.06, deadband + needed * (1 - deadband)));
  return [centre, Math.min(0.98, centre * 1.35), Math.min(0.98, centre * 0.75)];
}

/**
 * Replay the plan into a throwaway store.
 *
 * This is not a dry run in spirit: it applies every planned mutation through the same
 * GraphStore the real run uses and reports what the domain rules say. A plan that fails here
 * never touches the caller's project.
 */
export function replayPlan(plan, goal) {
  const issues = [];
  if (plan.infeasible) return { issues };
  const skeleton = plan.skeleton;
  const store = new GraphStore(withKindDefaults({
    schema_version: 3,
    id: goal.project_id ?? '0'.repeat(32),
    domain: goal.domain,
    revision: 0,
    created_at: '1970-01-01T00:00:00Z',
    updated_at: '1970-01-01T00:00:00Z',
    nodes: [],
    edges: [],
  }));
  for (const node of skeleton.nodes) {
    const result = store.apply({
      operation: 'node.add',
      expected_revision: store.read().revision,
      mutate: (graph) => {
        graph.nodes.push(structuredClone(node));
        return graph;
      },
    });
    if (!result.ok) {
      issues.push(...result.issues.filter((issue) => issue.severity === 'error'));
      return { issues };
    }
  }
  for (const edge of skeleton.edges) {
    const result = store.apply({
      operation: 'edge.connect',
      expected_revision: store.read().revision,
      mutate: (graph) => {
        graph.edges.push(structuredClone(edge));
        return graph;
      },
    });
    if (!result.ok) {
      issues.push(...result.issues.filter((issue) => issue.severity === 'error'));
      return { issues };
    }
  }
  return { issues };
}

function purposeFor(kind) {
  const purposes = {
    'env.water_body': 'the fluid the hull displaces water in',
    'env.airspace': 'the air the vehicle flies in',
    'env.ground': 'the surface the vehicle rests on',
    'mech.hull': 'the body whose speed the goal names',
    'mech.airframe': 'the body whose altitude the goal names',
    'mech.float': 'a buoyant float',
    'mech.body': 'a rigid body',
    'mech.rotor': 'rotor thrust',
    'mech.pwm_source': 'the declared open-loop command the actuators follow',
    'mech.control_law': 'a declared control law closing a loop on physics',
    'actuator.thruster': 'converts a PWM command into a force on the hull',
    'actuator.force': 'converts a signal into a force',
    'actuator.servo': 'converts a PWM command into a torque',
    'mech.barometer': 'physics-derived pressure the firmware can read',
    'mech.depth_sensor': 'physics-derived depth the firmware can read',
    'mech.imu': 'physics-derived specific force',
    'mech.compass': 'physics-derived heading',
    'software.computer': 'the machine the app runs inside',
    'software.web_app': 'the application the goal asks for',
    'software.script': 'a declared program over measured values',
  };
  return purposes[kind] ?? 'declared node';
}