import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCapability } from '../../../../scripts/gen-capability.mjs';
import { circuitSolver } from '../../../../packages/solvers/circuit/manifest.mjs';
import { mcuSolver } from '../../../../packages/solvers/mcu/manifest.mjs';
import { SolverUnavailable, validateManifest } from '../../../../packages/solvers/protocol.mjs';
import { SolverRegistry } from '../../../../packages/solvers/registry.mjs';
import { verifySolver } from '../../../../packages/solvers/verify.mjs';
import { explainCapability, readCapability, resolveProjectCapability } from '../../../../packages/solvers/capability.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const kinds = JSON.parse(readFileSync(resolve(root, 'contracts/kinds.json'), 'utf8')).kinds;
const capability = await generateCapability();
const declaredCapability = readCapability();
const projectCapability = resolveProjectCapability(declaredCapability, {
  id: 'fixture-project',
  revision: 7,
  board: 'arduino-uno',
  components: [{ id: 'motor-driver', type: 'motor-driver-l293d' }],
});
const boatCapability = resolveProjectCapability(declaredCapability, {
  id: 'boat-project',
  domain: 'mechanics',
  nodes: [],
  edges: [],
});
const availability = readFileSync(resolve(root, 'docs/COMPONENT_SIMULATION_AVAILABILITY.md'), 'utf8');
const releaseStatus = readFileSync(resolve(root, 'RELEASE_STATUS.md'), 'utf8');

assert.equal(capability.generator_status, 'generated');
assert.match(capability.generated_at, /^sha256:[a-f0-9]{64}$/);
assert.equal(projectCapability.project_id, 'fixture-project');
assert.equal(projectCapability.revision, 7);
assert.equal(projectCapability.nodes.find((node) => node.id === 'board')?.simulated, true);
assert.equal(projectCapability.nodes.find((node) => node.id === 'motor-driver')?.simulated, false);
assert.equal(projectCapability.can_run, false);
assert.ok(explainCapability('board.esp32-c3').limitations.some((entry) => entry.reason.includes('0x514c26')));
assert.equal(boatCapability.can_run, false);
assert.ok(boatCapability.blockers.some((entry) =>
  entry.reason === 'No verified mechanics solver is registered.'
  && entry.required_to_support.includes('deterministic, verified mechanics solver')));
for (const [, , legacyType] of availability.matchAll(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/gm)) {
  const kind = kinds.find((entry) => entry.legacy_type === legacyType || entry.id.endsWith(`.${legacyType}`));
  assert.ok(
    capability.unsupported.some((entry) => entry.kind === kind?.id || entry.feature.includes(`(${legacyType})`)),
    `documented unsupported component ${legacyType} must be represented`,
  );
}
const releaseCoverage = [
  [['simulation', 'browser'], (entry) => entry.feature.toLowerCase().includes('headless')],
  [['single', 'domain'], (entry) => /mechanics|environment|software/i.test(entry.feature)],
  [['compiler', 'sandbox'], (entry) => entry.feature.toLowerCase().includes('compiler')],
  [['auth'], (entry) => entry.feature.toLowerCase().includes('authentication')],
  [['esp32-c3'], (entry) => entry.reason.includes('PC 0x514c26')],
  [['remote', 'esp32'], (entry) => entry.feature.toLowerCase().includes('remote esp32')],
  [['agpl'], (entry) => entry.feature.toLowerCase().includes('licensing')],
];
for (const [tokens, represented] of releaseCoverage) {
  assert.ok(releaseStatus.toLowerCase().includes(tokens[0]), `release blocker ${tokens.join(' ')} must remain in the source document`);
  assert.ok(capability.unsupported.some(represented), `release blocker ${tokens.join(' ')} must be represented`);
}

const c3 = capability.kinds.find((kind) => kind.id === 'board.esp32-c3');
assert.equal(c3?.simulated, false);
assert.ok(capability.unsupported.some((entry) =>
  entry.reason.includes('PC 0x514c26') && entry.reason.includes('2,666,667 cycles')));
assert.equal(
  mcuSolver.manifest.knownFailures[0].message,
  'Vendor RiscVCore adapter fails at PC 0x514c26 after 2,666,667 cycles.',
);
assert.ok(capability.kinds
  .filter((kind) => kind.id.startsWith('board.esp32'))
  .every((kind) => !kind.simulated));
assert.ok(capability.unsupported.some((entry) => entry.feature === 'mechanics simulation'));
assert.ok(capability.unsupported.some((entry) => entry.feature === 'environment simulation'));
assert.ok(capability.unsupported.some((entry) => entry.feature === 'software simulation'));

assert.throws(() => validateManifest({
  id: 'dishonest',
  version: '1',
  kindIds: [],
  telemetryChannels: [],
  analyses: [],
  limits: {},
  confidence: 'verified',
  verification: { tests: [] },
  knownFailures: [],
  unavailable: [],
}), /cannot self-declare confidence/);

const fakeSolver = (id, kindIds = []) => ({
  manifest: {
    id,
    version: '1',
    kindIds,
    telemetryChannels: [],
    analyses: [],
    limits: {},
    verification: { tests: ['missing/test'] },
    knownFailures: [],
    unavailable: [],
  },
  async selfTest() { return true; },
  async prepare() { return {}; },
  async run() { return {}; },
  async dispose() {},
});
const registry = new SolverRegistry();
registry.register(fakeSolver('first', ['test.kind']));
assert.throws(() => registry.register(fakeSolver('first', [])), /Duplicate solver id/);
assert.throws(() => registry.register(fakeSolver('second', ['test.kind'])), /claimed by both/);
assert.equal(registry.solverFor('missing.kind'), undefined);
assert.equal((await verifySolver(fakeSolver('partial'), { testReport: {} })).confidence, 'partial');

await assert.rejects(
  circuitSolver.prepare({ nodes: [], analysis: 'ac' }, { services: {} }),
  (error) => error instanceof SolverUnavailable
    && error.requiredToSupport === 'ngspice AC sweep implementation',
);
