# v03 — GRAPH CORE

**Goal:** implement `packages/core/graph` — the universal project store. One graph model that a
circuit, a boat, a drone and a website all use. After this phase, adding a domain means adding node
kinds, never forking the project model.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0 and §3 apply in full. `AGENTS.md` applies. Contract truth comes
from `contracts/` (`v02`).

---

## 1. Context

`backend/hardware.py` already has a working project store: integer `revision`, atomic mutations,
`_undo` snapshots bounded to 50, `history` bounded to 200, revision checks that return `409`.
That behaviour is **production** and must be preserved exactly.

What it does not have: any notion of a node `kind` namespace, ports, typed edges, containment
(`parent_id`), environments, or a domain. Today a project is `{board, components[], wires[],
firmware}` — that shape cannot express a boat.

This phase extracts that store into a domain-agnostic graph, and keeps the old shape alive at the
edges via adapters.

---

## 2. Preconditions — verify, do not assume

1. `contracts/graph.schema.json`, `contracts/port-types.json`, `contracts/kinds.json` exist and
   `npm run contracts:check` passes.
2. `packages/core/contracts` exports `Graph`, `Node`, `Edge`, `validateGraph`.
3. Read `backend/hardware/projects.py` (`HardwareService`) fully. You are extracting, not
   reimplementing. Note the exact semantics of: revision increment, `_undo` push, `history` append,
   `compiler.stale` invalidation, `updated_at`, and the `expected_revision` mismatch path.
4. Read `backend/hardware/breadboard_routing.py` and note that wire routing is a **derived**
   property (waypoints), not source data. Preserve that.
5. Confirm `backend/data/hardware/` shape by listing one real project file. Do not include real
   project data in fixtures — copy and anonymise.

---

## 3. What to build — `packages/core/graph/`

### 3.1 `types.ts`
Re-export the contract types. Add only the in-code types the contract does not express:
`GraphStore`, `Transaction`, `MutationResult`, `ValidationIssue`, `GraphDiff`. Keep these minimal.

### 3.2 `store.ts` — `GraphStore`

Pure TypeScript, **no I/O**. The store takes a `Graph` and returns new `Graph` values. This is
deliberate: persistence is an adapter concern, so the same store runs in the browser, in Node, in
a worker, and in tests.

```
class GraphStore {
  constructor(graph: Graph)
  read(): Graph                                    // deep-frozen
  readNode(id: string): Node
  readEdge(id: string): Edge
  descendants(id: string): Node[]                  // via parent_id, cycle-safe
  ancestors(id: string): Node[]
  apply(tx: Transaction): MutationResult
  undo(): MutationResult
  history(): HistoryEntry[]
  export(): string                                 // canonical JSON, sorted keys
}
```

`apply` performs, in order, and stops at the first failure returning **all** issues:

1. Schema validation of the resulting graph.
2. Kind existence: every node `kind` is in `contracts/kinds.json`.
3. Node id uniqueness and id-prefix agreement with kind.
4. Edge endpoint existence; self-edges on `inout` ports only.
5. Port existence on both endpoints.
6. Port type compatibility via `contracts/port-types.json`.
7. **Domain rules**, delegated to a registry (§3.4).
8. Containment acyclicity — `parent_id` must not form a cycle.
9. Only then: increment `revision`, push `_undo`, append `history`, set `updated_at`.

`MutationResult`:

```
{ ok: true,  graph: Graph, changed: {nodes:{added,removed,modified},edges:{…}}, revision }
{ ok: false, issues: ValidationIssue[] }   // ValidationIssue = { pointer, code, message, severity:"error"|"warning" }
```

`ValidationIssue.code` is a closed enum: `SCHEMA`, `UNKNOWN_KIND`, `DUPLICATE_ID`, `ID_MISMATCH`,
`DANGLING_ENDPOINT`, `SELF_EDGE`, `UNKNOWN_PORT`, `INCOMPATIBLE_PORT`, `CYCLE`, `DOMAIN_RULE`,
`REVISION_STALE`. Error messages must name the offending node/edge/port by id and label.

### 3.3 `canonical.ts`
Canonical JSON: sorted object keys, no insignificant whitespace, UTF-8, numbers normalised
(no `-0`, no `1.0` vs `1` drift). `canonicalStringify(value)` and `parseCanonical(text, schemaId)`.
All hashes in the system (artifacts, manifest, capability) use this. Determinism is invariant I9.

### 3.4 `rules/` — the domain rule registry

```
registerDomainRule(domain: string, rule: (graph) => ValidationIssue[])
```

Ship exactly three, extracted from behaviour that already exists or is already documented:

- `electronics` — a project has **at most one** board node (`board.*` kind); every board node's
  connected edges must reference ports that exist in that board's pin layout
  (`backend/hardware/boards.py` `PIN_LAYOUTS`); a component node must not connect to a pin the
  board does not expose. Warning severity, not error — matches today's behaviour where an unknown
  pin is disclosed rather than blocked.
- `electronics` (error severity) — two `power.*` outputs connected directly to each other is a
  rail short. This exists today in `backend/circuit_wiring.py`; port it, do not reinvent it, and
  keep the same error code and message text so existing tests keep passing.
- `mechanics` — a node with `solver:"mechanics"` that has a `mech.torque` in-port must have either
  a parent actuator node or an `env.reference` edge; a `mech.hull` must be a descendant of a
  `mech.water_body` or have an `env.reference` edge to one.

Registry is extensible; ship only these three. `software` and `environment` rules arrive in `v11`
and `v12`.

### 3.5 `adapters/electronics.ts` — legacy shape bridge

Bidirectional, lossless for everything the current UI needs:

- `fromLegacy(project: LegacyProject): Graph` — `{board, components[], wires[], firmware}` →
  nodes (`board.<id>` + one node per component, `kind` resolved through `contracts/kinds.json`) and
  edges (one per wire, port types resolved from `contracts/port-types.json`).
- `toLegacy(graph: Graph): LegacyProject` — exact inverse, including component `properties`,
  `rotation`, wire `color`, and `waypoints`.
- `legacyDiff(from: LegacyProject, to: LegacyProject): MutationResult` — converts a legacy
  mutation (`add_component`, `connect_wire`, `modify_component`, `remove_*`, `wire_circuit`,
  `validate_circuit`, `check_connections`, `route_breadboard`) into the equivalent graph
  `Transaction`, applies it to the store, then converts back.

`legacyDiff` is the bridge that lets `v04` rewire the existing backend without changing what the
UI sees. It must be covered by a **property test**: for 200 randomised legacy projects, apply a
random legacy mutation, convert both ways, and assert `toLegacy(fromLegacy(original))` deep-equals
the original, and that the mutated legacy project round-trips through the store to the same state.

**Ambiguity handling:** any legacy component whose kind cannot be resolved from
`contracts/kinds.json` becomes `part.unresolved_<group>` with `properties.legacy_type` preserved
verbatim and a `warning` issue emitted. Never drop it, never guess.

### 3.6 `persistence/` — Node and browser adapters

- `persistence/file.ts` — `load(dir)/save(dir)` for the API service. Atomic write: write to
  `<name>.tmp`, `fsync`, `rename`. A crash mid-write must never corrupt a project.
- `persistence/idb.ts` — IndexedDB adapter using `idb-keyval` (**already a dependency**). No new dep.
- `persistence/memory.ts` — for tests and workers.
- All three satisfy one `GraphPersistence` interface. A round-trip test runs each and asserts
  byte-equal `canonicalStringify`.

### 3.7 `selectors.ts`
Pure read helpers used by UI, MCP and solvers: `byKind`, `byKindGroup`, `roots`, `sensorsFor`,
`actuatorsFor`, `telemetryChannelsFor`, `portsOf`, `neighbours`, `pathBetween`, `bomOf`
(coarse: node kind + quantity + declared unit price if `contracts/kinds.json` provides one).
Keep it to exactly these. Do not build a query language.

### 3.8 Bench fixtures

Migrate **three** real shapes into `bench/cases/`:
- `bench/cases/electronics/blink/` — Uno + LED + resistor + firmware (the canonical smallest case)
- `bench/cases/electronics/i2c-sensor/` — board + I2C sensor + pull-ups (exercises port typing)
- `bench/cases/mechanics/boat-minimal/` — hull + 2 thrusters + water body + an ESP32 bridge node

Each with `case.json`, `project.json`, `spec.md`, `assertions.json`.

---

## 4. Files

**Create:** `packages/core/graph/**`, `packages/core/package.json`, `bench/cases/electronics/blink/**`,
`bench/cases/electronics/i2c-sensor/**`, `bench/cases/mechanics/boat-minimal/**`.

**Modify:** root `package.json` (add `"core:test"` script), `docs/ARCHITECTURE.md`.

**Do not touch:** `backend/**`, `src/hardware/**`, `src/components/**`, `contracts/**`,
`vendor/**`. This phase adds the new model **beside** the old one. Nothing switches over until
`v04`.

---

## 5. APPROVED DEPS

None beyond `ajv` (already added in `v02`) and `idb-keyval` (already present).

---

## 6. Acceptance criteria

`assertions.json` files for the three cases, plus:

- **A1** `legacyDiff` property test: 200 randomised mutations, zero round-trip mismatches.
  Add a `npm run core:test` script.
- **A2** All six negative graphs from `v02` A4 are rejected by `GraphStore.apply` with the correct
  `ValidationIssue.code` and a message naming the offender's id.
- **A3** Rail short: two `power.dc` outputs connected → `ok:false`, `code:"DOMAIN_RULE"`, and the
  message text matches the existing `backend/circuit_wiring.py` wording (assert string equality
  against the existing text, so behaviour is provably unchanged).
- **A4** Undo restores the exact prior graph: `canonicalStringify` equality, and undo of undo
  returns to the original.
- **A5** Revision semantics match existing behaviour: 50-entry undo bound, 200-entry history bound,
  `expected_revision` mismatch → `REVISION_STALE`, `updated_at` changes, `compiler.stale` set on
  any mutating transaction. Assert each.
- **A6** `canonicalStringify` is stable across key insertion order (fixture with 200 shuffled
  key orders → one hash).
- **A7** The three persistence adapters round-trip byte-identically.
- **A8** `bench/cases/mechanics/boat-minimal` validates clean under the `mechanics` domain rule.
- **A9** `npm run build`, `npm run lint`, `npm run core:test`, pytest and Playwright all show no
  new failures. Nothing existing was modified, so all must be exactly unchanged.

---

## 7. Verification

```powershell
npm run core:test
node bench/run.ts
npm run contracts:check
npm run build
npm run lint
node scripts/python.mjs -m pytest backend/tests -q
npm test -- --workers=1
```

---

## 8. Out of scope

- Any MCP surface. `v08`.
- Any solver, telemetry or trials. `v05`, `v06`.
- Rewiring the backend to use `GraphStore`. `v04`.
- The 3D room. `v10`.
- Making `GraphStore` observable/reactively bound to React. That is `v13`; keep this pure.

---

## 9. If you are blocked

The likely hard part is `fromLegacy`/`toLegacy` for parts whose kind is not in the registry. The
specified behaviour is `part.unresolved_<group>` with a warning — implement exactly that and move
on. Do not expand `contracts/kinds.json` yourself to make the problem disappear; that is a contract
change and belongs to a later phase.

If a legacy project cannot be represented without losing data (for example a wire whose endpoints
reference a pin that no longer exists), emit a `warning` issue and preserve the wire verbatim in
`properties.legacy`. Preservation beats fidelity.

---

## 10. Final report

`docs/phase-reports/v03_graph_core.md`: `BASELINE`, `LEGACY_SEMANTICS` (the §2 findings on existing
revision/undo behaviour), `ACCEPTANCE` table, `EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.