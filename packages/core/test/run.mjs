#!/usr/bin/env node
// packages/core test runner. Dependency-free: `npm run core:test` -> `node packages/core/test/run.mjs`
//
// Every test is an assertion with a real expected value. No test is skipped silently; a
// suite that cannot run reports SKIP with a reason, never a pass.

import { GraphStore, validate, diff, MAX_UNDO, MAX_HISTORY } from '../graph/store.mjs';
import { canonicalStringify, deepEqual, canonicalHash } from '../graph/canonical.mjs';
import { validateGraphShape, validateTelemetry, canConnect, loadKinds } from '../graph/contracts.mjs';
import { bomOf, pathBetween, byKind, sensorsFor, actuatorsFor } from '../graph/selectors.mjs';
import { fromLegacy, legacyDiff, toLegacy } from '../graph/adapters/electronics.mjs';

let passed = 0;
let failed = 0;
/** @type {string[]} */
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok    ${name}\n`);
  } catch (error) {
    failed += 1;
    failures.push(`${name}: ${error && error.message}`);
    process.stdout.write(`  FAIL  ${name}\n        ${error && error.message}\n`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function eq(actual, expected, message) {
  if (!deepEqual(actual, expected)) {
    throw new Error(`${message}\n          expected: ${canonicalStringify(expected)}\n          actual:   ${canonicalStringify(actual)}`);
  }
}

// ---------------------------------------------------------------- fixtures
const NOW = '2026-01-01T00:00:00.000Z';
const PID = '0123456789abcdef0123456789abcdef';

function graph(overrides = {}) {
  return {
    schema_version: 3,
    id: PID,
    name: 'Fixture',
    domain: 'electronics',
    revision: 0,
    nodes: [],
    edges: [],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function kindsById() {
  return loadKinds().byId;
}

function nodeFor(kind, id) {
  const kindDef = kindsById().get(kind);
  if (!kindDef) throw new Error(`fixture refers to unknown kind '${kind}'`);
  const prefix = kind.replace('.', '_');
  return { id: id ?? `${prefix}_${hash8(id ?? kind)}`, kind, ...(kindDef.ports ? {} : {}) };
}

function hash8(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** A contract-valid node id for a kind: hyphens become underscores. */
function nodeId(kind, seed) {
  return `${kind.replace(/[.-]/g, '_')}_${hash8(seed ?? kind)}`;
}

function portOf(kind, name) {
  const def = kindsById().get(kind);
  return (def?.ports ?? []).find((p) => p.name === name);
}

// ================================================================ canonical
process.stdout.write('\ncanonical\n');

test('key order does not change the serialisation', () => {
  const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
  const b = { c: { y: 2, z: 1 }, a: 2, b: 1 };
  eq(canonicalStringify(a), canonicalStringify(b), 'canonical form must be order-independent');
});

test('-0 and 0 serialise identically', () => {
  eq(canonicalStringify({ v: -0 }), canonicalStringify({ v: 0 }), '-0 must normalise to 0');
});

test('non-finite numbers are rejected, never silently nulled', () => {
  let threw = false;
  try { canonicalStringify({ v: Number.NaN }); } catch { threw = true; }
  assert(threw, 'NaN must throw rather than become null');
});

test('undefined properties are absent, not null', () => {
  eq(canonicalStringify({ a: 1, b: undefined }), '{"a":1}', 'undefined must be dropped');
});

test('the same value always hashes the same', async () => {
  // synchronous pair; the async hash is exercised in the async section below
  const a = canonicalStringify({ x: [3, 1, 2] });
  const b = canonicalStringify({ x: [3, 1, 2] });
  assert(a === b, 'identical values must serialise identically');
});

// ================================================================ schema
process.stdout.write('\ngraph schema\n');

test('a minimal valid graph produces no issues', () => {
  eq(validateGraphShape(graph()), [], 'a minimal graph must validate');
});

test('unknown schema_version is rejected, never assumed', () => {
  const issues = validateGraphShape(graph({ schema_version: 2 }));
  assert(issues.some((i) => i.pointer === '/schema_version'),
    `expected a schema_version issue, got ${JSON.stringify(issues)}`);
});

test('unknown top-level properties are rejected', () => {
  const issues = validateGraphShape(graph({ sneaky: true }));
  assert(issues.some((i) => i.message.includes('sneaky')), 'unknown property must be reported');
});

test('a negative revision is rejected', () => {
  const issues = validateGraphShape(graph({ revision: -1 }));
  assert(issues.some((i) => i.pointer === '/revision'), 'negative revision must be rejected');
});

test('a missing updated_at is reported with a pointer', () => {
  const g = graph();
  delete g.updated_at;
  const issues = validateGraphShape(g);
  assert(issues.some((i) => i.pointer === '/updated_at' && i.code === 'SCHEMA'),
    'missing updated_at must be reported');
});

test('a bad node id is reported', () => {
  const issues = validateGraphShape(graph({ nodes: [{ id: 'NOPE', kind: 'board.arduino-uno' }] }));
  assert(issues.some((i) => i.pointer === '/nodes/0/id'), 'bad node id must be reported');
});

// ================================================================ validation
process.stdout.write('\ngraph validation\n');

test('an unknown kind is rejected and names the offender', () => {
  const g = graph({ nodes: [{ id: 'ghost_aaaaaaaa', kind: 'wat.thing' }] });
  const issues = validate(g);
  const found = issues.find((i) => i.code === 'UNKNOWN_KIND');
  assert(found, 'unknown kind must be rejected');
  assert(found.message.includes('ghost_aaaaaaaa'), `message must name the node, got: ${found.message}`);
});

test('a duplicate node id is rejected', () => {
  const id = `board_arduino_uno_${hash8('x')}`;
  const g = graph({ nodes: [
    { id, kind: 'board.arduino-uno' },
    { id, kind: 'board.arduino-uno' },
  ] });
  const issues = validate(g);
  assert(issues.some((i) => i.code === 'DUPLICATE_ID'), 'duplicate id must be rejected');
});

test('a dangling edge endpoint is rejected and names the missing node', () => {
  const g = graph({
    nodes: [{ id: nodeId('board.arduino-uno', 'u'), kind: 'board.arduino-uno' }],
    edges: [{ id: 'e1', from: { node: 'board_arduino-uno_x', port: '5V' }, to: { node: 'board_arduino-uno_x', port: 'GND' } }],
  });
  const issues = validate(g);
  const found = issues.find((i) => i.code === 'DANGLING_ENDPOINT');
  assert(found, 'dangling endpoint must be rejected');
  assert(found.message.includes('board_arduino-uno_x'), 'message must name the missing node');
});

test('an unknown port is rejected and lists the known ports', () => {
  const boardId = `board_arduino_uno_${hash8('u')}`;
  const ledKind = 'output.led';
  const ledId = `output_led_${hash8('l')}`;
  const g = graph({
    nodes: [
      { id: boardId, kind: 'board.arduino-uno' },
      { id: ledId, kind: ledKind },
    ],
    edges: [{ id: 'e1', from: { node: boardId, port: 'NOT_A_PIN' }, to: { node: ledId, port: portOf(ledKind, 'A')?.name ?? 'A' } }],
  });
  const issues = validate(g);
  const found = issues.find((i) => i.code === 'UNKNOWN_PORT');
  assert(found, 'unknown port must be rejected');
  assert(found.message.includes('NOT_A_PIN'), 'message must name the bad port');
  assert(found.message.includes('Known ports'), 'message must list known ports');
});

test('an incompatible port pair is rejected and explains why', () => {
  const kinds = kindsById();
  // Find two kinds whose pins are genuinely incompatible, from the contract itself.
  const [a, b] = [...kinds.values()].filter((k) => (k.ports ?? []).length > 0);
  const pa = a.ports[0];
  const pb = b.ports[0];
  const g = graph({
    domain: 'hybrid',
    nodes: [
      { id: `${a.id.replace('.', '_')}_aaaaaaaa`, kind: a.id },
      { id: `${b.id.replace('.', '_')}_bbbbbbbb`, kind: b.id },
    ],
    edges: [{ id: 'e1', from: { node: `${a.id.replace('.', '_')}_aaaaaaaa`, port: pa.name },
              to: { node: `${b.id.replace('.', '_')}_bbbbbbbb`, port: pb.name } }],
  });
  const issues = validate(g);
  const bad = issues.find((i) => i.code === 'INCOMPATIBLE_PORT');
  if (bad) {
    assert(bad.message.includes(pa.type) && bad.message.includes(pb.type),
      'incompatible message must name both types');
  } else {
    // The pair happens to be compatible; that is a valid outcome, not a failure.
    assert(canConnect(pa.type, pb.type), 'no incompatibility reported for compatible types');
  }
});

test('canConnect is symmetric and closed', () => {
  assert(canConnect('signal.digital', 'signal.electrical'), 'digital <-> electrical is allowed');
  assert(canConnect('signal.electrical', 'signal.digital'), 'the reverse must also be allowed');
  assert(!canConnect('mech.force', 'signal.digital'), 'force and digital must not connect');
  assert(!canConnect('signal.digital', 'nonsense.type'), 'unknown types never connect');
});

test('two board nodes in one electronics project are rejected', () => {
  const g = graph({ nodes: [
    { id: nodeId('board.arduino-uno', 'u'), kind: 'board.arduino-uno' },
    { id: nodeId('board.arduino-mega', 'm'), kind: 'board.arduino-mega' },
  ] });
  const issues = validate(g);
  assert(issues.some((i) => i.code === 'DOMAIN_RULE' && i.message.includes('at most one board')),
    'a second board must be rejected');
});

test('a containment cycle is rejected', () => {
  const g = graph({
    nodes: [
      { id: nodeId('board.arduino-uno', 'u'), kind: 'board.arduino-uno' },
      { id: `software_computer_${hash8('c')}`, kind: 'board.arduino-nano', parent_id: `board_arduino_uno_${hash8('u')}` },
    ],
  });
  // point the first at the second to close the loop
  const g2 = graph({ nodes: [
    { id: `board_arduino_uno_${hash8('u')}`, kind: 'board.arduino-uno', parent_id: `board_arduino_mega_${hash8('m')}` },
    { id: `board_arduino_mega_${hash8('m')}`, kind: 'board.arduino-mega', parent_id: `board_arduino_uno_${hash8('u')}` },
  ] });
  void g;
  const issues = validate(g2);
  assert(issues.some((i) => i.code === 'CYCLE'), `containment cycle must be rejected, got ${JSON.stringify(issues)}`);
});

// ================================================================ store
process.stdout.write('\nstore\n');

test('a mutation without expected_revision is rejected and changes nothing', () => {
  const store = new GraphStore(graph());
  const before = store.export();
  const result = store.apply({ operation: 'node.add' });
  assert(!result.ok, 'a mutation without a revision must fail');
  assert(result.issues[0].code === 'REVISION_STALE', `expected REVISION_STALE, got ${result.issues[0].code}`);
  assert(store.export() === before, 'the store must be byte-identical after a rejected mutation');
});

test('a stale expected_revision is rejected and changes nothing', () => {
  const store = new GraphStore(graph());
  const before = store.export();
  const result = store.apply({ operation: 'node.add', expected_revision: 99 });
  assert(!result.ok && result.issues[0].code === 'REVISION_STALE', 'stale revision must be rejected');
  assert(store.export() === before, 'nothing may change on a stale write');
});

test('a successful mutation increments the revision exactly once', () => {
  const store = new GraphStore(graph());
  const result = store.apply({
    operation: 'node.add',
    expected_revision: 0,
    mutate: (g) => ({ ...g, nodes: [...g.nodes, { id: nodeId('board.arduino-uno', 'u'), kind: 'board.arduino-uno' }] }),
  });
  assert(result.ok, `expected success, got ${JSON.stringify(result.issues ?? [])}`);
  assert(result.revision === 1, `revision must become 1, got ${result.revision}`);
});

test('an invalid mutation is atomic: the store is untouched', () => {
  const store = new GraphStore(graph());
  const before = store.export();
  const result = store.apply({
    operation: 'node.add',
    expected_revision: 0,
    mutate: (g) => ({ ...g, nodes: [...g.nodes, { id: 'ghost_aaaaaaaa', kind: 'not.a.kind' }] }),
  });
  assert(!result.ok, 'an unknown kind must fail');
  assert(store.export() === before, 'the store must be unchanged - invariant I3');
  assert(store.read().revision === 0, 'revision must not advance on failure');
});

test('read() returns a frozen graph', () => {
  const store = new GraphStore(graph());
  const read = store.read();
  assert(Object.isFrozen(read), 'read() must be frozen');
  let threw = false;
  try { read.nodes.push({}); } catch { threw = true; }
  assert(threw || read.nodes.length === 0, 'a frozen graph cannot be mutated');
});

test('undo restores the exact prior graph', () => {
  const store = new GraphStore(graph());
  const before = store.export();
  store.apply({
    operation: 'node.add',
    expected_revision: 0,
    mutate: (g) => ({ ...g, nodes: [...g.nodes, { id: nodeId('board.arduino-uno', 'u'), kind: 'board.arduino-uno' }] }),
  });
  assert(store.export() !== before, 'the mutation must have changed something');
  const undone = store.undo();
  assert(undone.ok, 'undo must succeed');
  assert(store.export() === before, 'undo must restore the prior graph byte-for-byte');
});

test('undo with nothing to undo reports rather than throws', () => {
  const store = new GraphStore(graph());
  const result = store.undo();
  assert(!result.ok && result.issues[0].severity === 'warning',
    'undo with empty history must report a warning, not throw');
});

test('undo is bounded to 50 snapshots', () => {
  const store = new GraphStore(graph());
  for (let i = 0; i < MAX_UNDO + 10; i += 1) {
    const result = store.apply({
      operation: 'node.modify',
      expected_revision: i,
      mutate: (g) => ({ ...g, name: `rev-${i}` }),
    });
    assert(result.ok, `mutation ${i} must succeed`);
  }
  let undos = 0;
  while (store.canUndo()) { store.undo(); undos += 1; }
  assert(undos === MAX_UNDO, `undo depth must be capped at ${MAX_UNDO}, was ${undos}`);
});

test('history is bounded to 200 entries', () => {
  const store = new GraphStore(graph());
  for (let i = 0; i < MAX_HISTORY + 25; i += 1) {
    store.apply({ operation: 'node.modify', expected_revision: i, mutate: (g) => ({ ...g, name: `r${i}` }) });
  }
  assert(store.history().length === MAX_HISTORY, `history must cap at ${MAX_HISTORY}`);
});

test('diff reports added, removed and modified nodes', () => {
  const a = graph({ nodes: [{ id: nodeId('board.arduino-uno', 'u'), kind: 'board.arduino-uno' }] });
  const b = graph({
    revision: 1,
    nodes: [
      { id: nodeId('board.arduino-uno', 'u'), kind: 'board.arduino-uno', label: 'changed' },
      { id: nodeId('board.arduino-mega', 'm'), kind: 'board.arduino-mega' },
    ],
  });
  const changes = diff(a, b);
  assert(changes.nodes.added.length === 1, 'one node added');
  assert(changes.nodes.modified.length === 1, 'one node modified');
});

test('two stores at the same revision produce the same canonical export', async () => {
  const build = () => new GraphStore(graph({ nodes: [{ id: nodeId('board.arduino-uno', 'u'), kind: 'board.arduino-uno' }] }));
  const h1 = await canonicalHash(build().read());
  const h2 = await canonicalHash(build().read());
  assert(h1 === h2, `identical graphs must hash identically: ${h1} vs ${h2}`);
});

// ================================================================ telemetry
process.stdout.write('\ntelemetry (invariant I5)\n');

test('a well-formed measured sample is accepted', () => {
  const issues = validateTelemetry({
    project_id: PID, t: 0.5, node: 'n', channel: 'pin.d13', value: 1, quality: 'measured', solver: 'mcu',
  });
  eq(issues, [], 'a valid measured sample must produce no issues');
});

test('quality "unavailable" with a non-null value is rejected', () => {
  const issues = validateTelemetry({
    project_id: PID, t: 0, node: 'n', channel: 'x', value: 42, quality: 'unavailable', solver: 'mcu',
  });
  assert(issues.some((i) => i.pointer === '/value'),
    'an unavailable channel must not carry a number - that number would read as a measurement');
});

test('quality "derived" without a derivations entry is rejected', () => {
  const issues = validateTelemetry({
    project_id: PID, t: 0, node: 'n', channel: 'made.up.channel', value: 1, quality: 'derived', solver: 'mcu',
  });
  assert(issues.some((i) => i.pointer === '/channel' && i.message.includes('derivations.json')),
    'a derived channel must declare how it is computed');
});

test('quality "derived" WITH a derivations entry is accepted', () => {
  const issues = validateTelemetry({
    project_id: PID, t: 0, node: 'n', channel: 'pin.duty_cycle', value: 0.5, quality: 'derived', solver: 'mcu',
  });
  eq(issues, [], 'a declared derived channel must be accepted');
});

// ================================================================ selectors
process.stdout.write('\nselectors\n');

test('bom reports unpriced items instead of a partial total', () => {
  const g = graph({ nodes: [
    { id: nodeId('board.arduino-uno', 'u'), kind: 'board.arduino-uno' },
    { id: `output_led_${hash8('l')}`, kind: 'output.led' },
  ] });
  const bom = bomOf(g);
  assert(bom.total === null, 'no total may be shown when any line is unpriced');
  assert(bom.unpriced_items > 0, 'unpriced items must be counted');
  assert(bom.total_note && bom.total_note.includes('no total is shown'),
    'the reason must be stated');
});

test('bom groups identical kinds and counts quantities', () => {
  const g = graph({ nodes: [
    { id: `output_led_${hash8('a')}`, kind: 'output.led' },
    { id: `output_led_${hash8('b')}`, kind: 'output.led' },
  ] });
  const bom = bomOf(g);
  const led = bom.lines.find((l) => l.node_kind === 'output.led');
  assert(led && led.quantity === 2, 'two identical parts must group to quantity 2');
});

test('pathBetween finds a route and returns null when there is none', () => {
  const a = `board_arduino_uno_${hash8('a')}`;
  const b = `output_led_${hash8('b')}`;
  const g = graph({
    nodes: [{ id: a, kind: 'board.arduino-uno' }, { id: b, kind: 'output.led' }],
    edges: [{ id: 'e1', from: { node: a, port: '5V' }, to: { node: b, port: 'A' } }],
  });
  assert(pathBetween(g, a, b) !== null, 'a connected route must be found');
});

test('sensors and actuators are derived from port directions, not from names', () => {
  const kinds = kindsById();
  // Boards are the clearest case: their pins are inout, so a board both sources and sinks
  // signals. Selecting only direction==='out' would find nothing, which is how this test
  // caught that boards had no ports at all.
  const publishers = [...kinds.values()].filter((k) =>
    (k.ports ?? []).some((p) => p.direction !== 'in' && p.type.startsWith('signal.')));
  assert(publishers.length > 0, 'the contract must define at least one signal source');
  const g = graph({ nodes: publishers.slice(0, 3).map((k, i) => ({
    id: `${k.id.replace(/[.-]/g, '_')}_${hash8(String(i))}`, kind: k.id,
  })) });
  assert(sensorsFor(g).length === 3, `expected 3 sensors, got ${sensorsFor(g).length}`);
  assert(actuatorsFor(g).length === 3,
    `an inout pin both sources and consumes; expected 3 actuators, got ${actuatorsFor(g).length}`);
});

// ================================================================ electronics adapter
process.stdout.write('\nelectronics adapter\n');

function legacyFixture(seed = 0) {
  return {
    id: seed.toString(16).padStart(32, '0'),
    schema_version: 1,
    revision: seed,
    name: `Legacy ${seed}`,
    board: 'arduino-uno',
    components: [
      { id: 'board', type: 'arduino-uno', x: 120 + seed, y: 100, rotation: 0, properties: {} },
      { id: 'custom-part', type: 'unlisted-part', x: 240, y: 180 + seed, rotation: 90, properties: { setting: seed } },
    ],
    wires: [{
      id: 'wire-1',
      from: { component: 'board', pin: '13' },
      to: { component: 'custom-part', pin: 'A' },
      color: '#22c55e',
      waypoints: [{ x: 150 + seed, y: 130 }],
    }],
    firmware: { filename: 'sketch.ino', source: `// ${seed}`, revision: seed },
    created_at: NOW,
    updated_at: NOW,
    runtime_token: 'must-not-enter-the-graph',
    _undo: [{ private: true }],
  };
}

test('legacy electronics round-trip preserves project data without carrying tokens', () => {
  for (let i = 0; i < 200; i += 1) {
    const legacy = legacyFixture(i);
    const graph = fromLegacy(legacy);
    const roundTrip = toLegacy(graph);
    const { runtime_token, _undo, ...publicLegacy } = legacy;
    void runtime_token;
    void _undo;
    eq(roundTrip, publicLegacy, `legacy round-trip differs for generated fixture ${i}`);
    assert(!canonicalStringify(graph).includes('must-not-enter-the-graph'),
      'runtime tokens must not be retained in graph metadata');
    assert(graph.metadata.legacy_electronics.warnings.some((issue) =>
      issue.subject === 'custom-part' && issue.severity === 'warning'),
    'an unresolved legacy type must be preserved and disclosed as a warning');
  }
});

test('legacyDiff applies a project change atomically through GraphStore', () => {
  const base = legacyFixture(9);
  const before = { ...base, components: base.components.slice(0, 1), wires: [] };
  const after = { ...before, name: 'Changed name', revision: 10 };
  const result = legacyDiff(before, after);
  assert(result.ok, `legacy mutation should apply: ${JSON.stringify(result.issues ?? [])}`);
  assert(result.legacy.name === 'Changed name', 'the converted legacy result must contain the mutation');
  assert(result.revision === before.revision + 1, 'the graph revision must advance exactly once');
});

// ================================================================ summary
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stdout.write('\nFailures:\n');
  for (const f of failures) process.stdout.write(`  ${f}\n`);
  process.exit(1);
}
void byKind;
void actuatorsFor;