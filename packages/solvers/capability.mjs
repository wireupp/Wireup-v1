import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContracts } from '../core/graph/contracts.mjs';
import { solverRegistry } from './index.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DOCUMENTED_LIMITATIONS = 'docs/COMPONENT_SIMULATION_AVAILABILITY.md';
const TEST_REPORT = resolve(ROOT, 'bench/results/testreport.json');

export function readCapability() {
  return JSON.parse(readFileSync(resolve(ROOT, 'contracts/capability.json'), 'utf8'));
}

function legacyKind(type, kinds) {
  return kinds.find((kind) => kind.legacy_type === type || kind.id.endsWith(`.${type}`))?.id ?? null;
}

export function projectNodeKinds(project) {
  const kinds = loadContracts().kinds.kinds;
  if (Array.isArray(project?.nodes)) {
    return project.nodes.map((node) => ({ id: node.id, kind: node.kind }));
  }
  const nodes = [];
  const board = project?.board;
  if (typeof board === 'string' && board !== 'unselected') {
    nodes.push({ id: 'board', kind: legacyKind(board, kinds) ?? `board.${board}` });
  }
  for (const component of project?.components ?? []) {
    const kind = legacyKind(component.type, kinds);
    nodes.push({ id: component.id, kind: kind ?? `unknown.${component.type}` });
  }
  return nodes;
}

export function resolveProjectCapability(capability, project) {
  const byKind = new Map(capability.kinds.map((entry) => [entry.id, entry]));
  const nodes = projectNodeKinds(project).map((node) => {
    const capabilityKind = byKind.get(node.kind);
    const supported = Boolean(capabilityKind?.simulated);
    return {
      ...node,
      simulated: supported,
      confidence: capabilityKind?.confidence ?? 'unknown',
      solver: capabilityKind?.solver ?? null,
      status: supported ? 'simulated' : 'placement_only',
      blocked_by: supported ? [] : [node.kind],
    };
  });
  const blockers = nodes.filter((node) => !node.simulated);
  const unavailableDomains = {
    mechanics: 'mechanics simulation',
    environment: 'environment simulation',
    software: 'software simulation',
  };
  const domains = project?.domain === 'hybrid'
    ? Object.keys(unavailableDomains)
    : [project?.domain];
  for (const domain of domains) {
    const feature = unavailableDomains[domain];
    if (!feature) continue;
    const limitation = capability.unsupported.find((entry) => entry.feature === feature);
    if (!limitation) continue;
    blockers.push({
      id: 'project-domain',
      kind: null,
      simulated: false,
      confidence: 'experimental',
      solver: domain,
      status: 'unavailable',
      blocked_by: [feature],
      reason: limitation.reason,
      required_to_support: limitation.required_to_support,
    });
  }
  return {
    project_id: project?.id ?? project?.project_id ?? null,
    revision: project?.revision ?? null,
    nodes,
    blockers,
    can_run: nodes.length > 0 && blockers.length === 0,
    runtime_requirement: 'MCU and browser analog simulation require their existing browser runtime.',
  };
}

export function explainCapability(kindId) {
  const kind = loadContracts().kinds.kinds.find((entry) => entry.id === kindId);
  if (!kind) throw Object.assign(new Error(`Unknown kind '${kindId}'.`), { code: 'UNKNOWN_KIND' });
  const solver = solverRegistry.solverFor(kindId);
  const capability = readCapability();
  const limitations = capability.unsupported.filter((entry) => entry.kind === kindId);
  const testRows = existsSync(TEST_REPORT)
    ? JSON.parse(readFileSync(TEST_REPORT, 'utf8')).rows ?? []
    : [];
  const failingTestIds = solver
    ? solver.manifest.verification.tests.filter((testId) => {
      const rows = testRows.filter((row) => row.id === testId);
      return rows.length === 0 || rows.some((row) => row.status !== 'pass');
    })
    : [];
  return {
    kind: kindId,
    exists: true,
    simulated: capability.kinds.find((entry) => entry.id === kindId)?.simulated ?? false,
    solver: solver?.manifest ?? null,
    failing_test_ids: failingTestIds,
    documentation: DOCUMENTED_LIMITATIONS,
    required_to_support: limitations.map((entry) => entry.required_to_support),
    limitations,
  };
}
