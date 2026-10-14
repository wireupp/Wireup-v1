# v02 — CONTRACTS

**Goal:** create `contracts/` — the machine-readable, versioned, test-enforced definition of every
shape in the platform. After this phase, no agent ever needs to read source code to know the API.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0 applies in full. This brief is final. Do not extend the schema
"for future needs" — only what §3 lists.

---

## 1. Context

Today the tool surface is duplicated in three places that can drift:

- `backend/hardware.py` `TOOLS` + the `command()` dispatcher (`:991`)
- `backend/agent.py` `_TOOL_FIELDS` / `_SCHEMAS` / `_DESCRIPTIONS` (`:177`, `:232`, `:207`)
- `src/lib/hardware.ts` TypeScript interfaces

They disagree today. The whole platform scales only if one contract generates all three. This
phase builds the contract; `v04` wires the generator to the tool bus.

---

## 2. Preconditions — verify, do not assume

1. `prompts/v01_REPO_GROUND_RULES.md` completed: `AGENTS.md` exists, CI is green, `bench/run.ts`
   runs. If `AGENTS.md` does not exist, stop and report.
2. `backend/agent/schemas.py` and `backend/hardware/commands.py` exist (v01's extractions).
3. `contracts/` does not already exist. If it does, read it and report what you find.
4. Record the current drift between the three tool definitions listed in §1 — count the tools and
   list any that exist in one place and not another. This becomes a bench assertion.

---

## 3. What to build

### 3.1 `contracts/manifest.json`

The entry point. Version, a list of every contract file with its `id`, `version`, `sha256` of the
file contents, and a one-line description. Any consumer verifies hashes against this manifest; a
mismatch is a hard error. Include `"generated_by": "v02"`.

### 3.2 `contracts/graph.schema.json` — JSON Schema 2020-12

The universal project model. Top-level object:

```
{
  "$schema", "$id": "wireup/graph/3",
  "type": "object",
  "required": ["schema_version","id","domain","revision","nodes","edges","created_at","updated_at"],
  "additionalProperties": false,
  "properties": {
    "schema_version": {"const": 3},
    "id":            {"type":"string","pattern":"^[a-f0-9]{32}$"},
    "name":          {"type":"string","minLength":1,"maxLength":120},
    "domain":        {"enum":["electronics","mechanics","software","environment","hybrid"]},
    "revision":      {"type":"integer","minimum":0},
    "parent_project_id": {"type":["string","null"]},
    "nodes":         {"type":"array","items":{"$ref":"#/$defs/Node"}},
    "edges":         {"type":"array","items":{"$ref":"#/$defs/Edge"}},
    "metadata":      {"type":"object"},
    "artifacts":     {"type":"array","items":{"$ref":"#/$defs/ArtifactRef"}},
    "firmware":      {"$ref":"#/$defs/Firmware"},
    "created_at":    {"type":"string","format":"date-time"},
    "updated_at":    {"type":"string","format":"date-time"}
  },
  "$defs": { "Node": …, "Edge": …, "Port": …, "ArtifactRef": …, "Firmware": … }
}
```

Define `$defs` precisely:

- **Node** — `{ id, kind, label?, parent_id?, position:{x,y,z?}, rotation?, properties{} }`.
  `id` pattern `^[a-z][a-z0-9_]*_[a-f0-9]{8}$` (kind prefix + hash) so a node id is
  self-describing in error messages. `kind` pattern `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`
  (`group.kind`, e.g. `passive.resistor`, `mech.hull`, `software.web_app`). No free-form kinds:
  a kind must exist in the kind registry (§3.4) or validation fails. `parent_id` gives the
  containment tree (the laptop contains the browser; the browser contains the page).
- **Edge** — `{ id, from:{node,port}, to:{node,port}, kind, value?, properties{} }`. Directional.
  `kind` from the port-type registry.
- **Port** — `{ name, type, direction:"in"|"out"|"inout", unit?, range?{min,max}?, required? }`.
- **ArtifactRef** — `{ id, kind:"hex"|"bin"|"elf"|"uf2"|"source"|"bom"|"screenshot"|"report",
  filename, media_type, sha256, bytes, created_at, produced_by, source_revision, project_revision }`.
- **Firmware** — `{ filename, language:"arduino"|"python"|"c"|"javascript"|"html", source,
  revision, target_board? }`. **One firmware document per project, not per node.** Firmware on a
  device inside a `software` domain project is just that device's target.

Document in the schema's `description` fields, for every field, what it means and what breaks if
it is wrong. Agents read these.

### 3.3 `contracts/port-types.json`

The type system for ports and edges. Each entry:

```
{ "id":"signal.electrical", "description":…, "units":["V","A"],
  "compatible_with":["signal.electrical"],
  "carries":"value"|"force"|"data"|"packet",
  "domains":["electronics","hybrid"] }
```

Seed it with **at least**: `signal.electrical`, `signal.digital`, `signal.pwm`, `signal.analog`,
`signal.serial`, `signal.i2c`, `signal.spi`, `power.dc`, `mech.force`, `mech.torque`,
`mech.linear`, `mech.angular`, `fluid.pressure`, `data.file`, `data.stream`, `net.tcp`,
`net.http`, `env.reference` (an edge that points a node at a shared environment source).

Rules encoded here: two ports may connect only if their types are `compatible_with`. A
`power.dc` output may connect to a `power.dc` input. A `mech.torque` output drives a
`mech.torque` input. `env.reference` connects only to a node input of matching domain. Everything
else is a typed error naming both ports — never a silent drop.

### 3.4 `contracts/kinds.json` — the node kind registry

Every buildable thing. Each entry:

```
{ "id":"passive.resistor", "label":"Resistor", "group":"passive",
  "ports":{ "in":[Port], "out":[Port] },
  "properties": { <JSON Schema object> },
  "defaults": { … },
  "solver": "circuit",
  "simulated": true,
  "notes": "…" }
```

Seed it by **mechanically extracting** what already exists — do not invent:
- From `src/hardware/velxioParts.ts` (component catalogue and pin layouts).
- From `backend/catalog/component-pins.json`.
- From the boards in `backend/hardware/boards.py` (`BOARDS`, `PIN_LAYOUTS`) — each board becomes
  `board.<id>` with ports derived from its pin layout and direction table.
- From `docs/COMPONENT_SIMULATION_AVAILABILITY.md` and
  `docs/SIMULATION_INTEGRATION_BACKLOG.md` for the `simulated` flag and the honest `notes` about
  which parts are placement-only.

Mark `simulated:false` honestly wherever the current platform only places a part without
behaviour. This field is load-bearing: it is what stops an AI claiming a part was tested.

### 3.5 `contracts/telemetry.schema.json`

```
{ "project_id","trial_id","t":<seconds, number>,
  "node":"<node id>","channel":"<string>","value":<number|string|bool|null>,
  "unit":"<string|null>",
  "quality":"measured"|"derived"|"assumed"|"unavailable",
  "solver":"<string>","seq":<integer> }
```

Hard rules, stated in the schema description: `measured` means a solver observed a physical or
emulated quantity. `derived` means computed from measured values (documented in
`contracts/derivations.json`). `assumed` means a default was substituted. `unavailable` means the
channel could not be produced — `value` must be `null`. Any sample with
`quality:"assumed"|"unavailable"` **must** be accompanied by a `contracts/derivations.json` entry
or the recorder rejects it. This is invariant I5, mechanically enforced.

### 3.6 `contracts/derivations.json`

Maps `channel` → `{ formula, inputs[], solver, confidence }`. Start with the derivations the current
platform already performs implicitly (for example a duty cycle → average voltage, RPM → tangential
speed, compass heading → unit vector). Empty entries are fine; **wrong** entries are not.

### 3.7 `contracts/trial.schema.json`

```
{ "id","project_id","goal":{ "metric":"channel.name","target":<number>,
                            "direction":"min"|"max"|"target","tolerance":<number>,
                            "window":[t0,t1] },
  "parameters":[{"node","property","values":[numbers]}],
  "environment_overrides":{…},
  "seed":<integer>,
  "runs":[{"index","seed","telemetry_ref","metrics":{},"verdict":"pass"|"fail"|"error",
           "error"?:{code,message}}],
  "verdict":"pass"|"fail"|"error",
  "summary":{} }
```

`parameters` is a sweep space. `verdict` is computed from `goal` only — never written by a caller.

### 3.8 `contracts/capability.schema.json` + `contracts/capability.json` (generated)

Declares what the platform can actually do. **Generated**, never hand-edited — the generator lives
in `v06`, so this phase ships the schema plus a placeholder generated file produced by
`scripts/gen-capability.mjs` reading `contracts/kinds.json` and a solver registry stub. Mark the
placeholder `"generator_status": "stub"` so nothing mistakes it for truth.

```
{ "generated_at","generator_version",
  "kinds":[{ "id","simulated","solver","limits":{} }],
  "telemetry_channels":[…],
  "unsupported":[{ "kind","reason","required_to_support" }],
  "environments":[…],
  "limits":{ "max_nodes", "max_trial_runs", "max_sim_seconds", "max_payload_bytes" } }
```

`unsupported` is the most important array in the platform. Populate it truthfully from
`RELEASE_STATUS.md` and the simulation backlog.

### 3.9 `contracts/tools/<name>.tool.json` — one file per tool

Every tool that will exist on the bus, including the ones not implemented yet. Schema:

```
{ "name":"component.add", "version":1,
  "title":"Add a component",
  "summary":"one line the model reads",
  "mutating": true,
  "requires_review": false,
  "args": { <JSON Schema object> },
  "result": { <JSON Schema object> },
  "errors":[{"code":"REVISION_STALE","when":"…"},{"code":"UNKNOWN_KIND","when":"…"}],
  "solver_requirements":["circuit"],
  "see_also":["component.remove"] }
```

Write these for the **union** of:
- every tool currently in `backend/agent/schemas.py` `_TOOL_FIELDS` (20 names),
- every tool currently in `backend/hardware/commands.py` `command()` (including `undo`,
  `wire_circuit`, `validate_circuit`, `check_connections`, `route_breadboard`),
- the new bus-level tools: `project.create`, `project.read`, `project.delete`, `project.export`,
  `node.add`, `node.remove`, `node.modify`, `edge.connect`, `edge.remove`, `catalog.search`,
  `catalog.read_kind`, `firmware.read`, `firmware.write`, `firmware.edit`, `firmware.compile`,
  `runtime.run`, `runtime.stop`, `runtime.probe`, `runtime.results`,
  `trial.run`, `trial.sweep`, `trial.read`,
  `bom.build`, `bom.read`, `assembly.read`, `capability.read`, `room.list`, `room.enter`,
  `telemetry.read`, `calculator.evaluate`, `session.create`.

Name mapping from the legacy names is required in `result.notes`: `add_component` →
`node.add`, etc. Preserve their argument shapes exactly; renaming the tool must not break the
existing agent. Add `"legacy_names": ["add_component"]` to each new tool file.

### 3.10 `packages/core/contracts/` — the loader

TypeScript, no runtime deps, used by every later phase.

- `loadManifest()`, `loadContract(id)`, `verifyManifest()` — hash check, throws on mismatch.
- `validateGraph(graph)` — full JSON Schema validation of a graph document, returning **all**
  errors with JSON pointers, not just the first.
- `validateToolArgs(name, args)`, `validateToolResult(name, result)`.
- `validateTelemetry(sample)` — including the derivations requirement from §3.5.
- `validateTrial(trial)`.
- Re-export the parsed types (`Graph`, `Node`, `Edge`, `TelemetrySample`, `Trial`, …) so consumers
  never hand-write interfaces. This is what kills the three-way drift.
- A JSON Schema validator is required. **APPROVED DEPS:** `ajv` (runtime) and `@types/ajv`
  (dev). Nothing else.

---

## 4. Files

**Create:** `contracts/manifest.json`, `contracts/graph.schema.json`, `contracts/port-types.json`,
`contracts/kinds.json`, `contracts/telemetry.schema.json`, `contracts/derivations.json`,
`contracts/trial.schema.json`, `contracts/capability.schema.json`, `contracts/capability.json`,
`contracts/tools/*.tool.json` (~50 files), `packages/core/contracts/**`,
`scripts/gen-capability.mjs`, `bench/cases/meta/contracts/assertions.json`.

**Modify:** `package.json` (adds `ajv`; adds `"contracts:check"` and `"contracts:gen"` scripts;
registers `packages/core` as an npm workspace), `AGENTS.md` (add the contracts section pointer —
edit, do not rewrite), `docs/ARCHITECTURE.md` (add the contracts layer).

**Do not touch:** `src/hardware/**`, `backend/agent/graph.py`, `backend/hardware/commands.py`,
`vendor/**`, `backend/catalog/**`, `src/components/**`.

The legacy tool definitions are **not** rewired in this phase. `v04` does that.

---

## 5. APPROVED DEPS

- runtime: `ajv`
- dev: `@types/ajv`

---

## 6. Acceptance criteria

`bench/cases/meta/contracts/assertions.json`:

- **A1** `node scripts/gen-capability.mjs` regenerates `contracts/capability.json`
  byte-identically (deterministic, no timestamps that change output — use the manifest hash).
- **A2** Every tool name in `backend/agent/schemas.py` `_TOOL_FIELDS` and in
  `backend/hardware/commands.py` appears in `contracts/tools/` with a `legacy_names` entry.
  The drift list from §2 is recorded in `bench/cases/meta/contracts/drift-baseline.json` and the
  assertion asserts the count has not grown.
- **A3** Every node kind in `contracts/kinds.json` resolves to at least one port in
  `contracts/port-types.json`, and no port references an unregistered type.
- **A4** `validateGraph` accepts a known-good electronics project migrated from an existing
  `backend/data/hardware/*.json` fixture, and rejects: unknown kind, dangling edge endpoint,
  incompatible port types, duplicate node id, negative revision, missing `updated_at`. All six
  negative cases are fixture files under `bench/cases/meta/contracts/invalid/`.
- **A5** `validateTelemetry` rejects a sample with `quality:"measured"` and no derivable channel,
  and rejects `quality:"unavailable"` with a non-null `value`.
- **A6** A round-trip test loads every schema in the manifest, validates its own `$defs` compile,
  and confirms `verifyManifest()` passes.
- **A7** `npm run contracts:check` passes; it is wired into CI.
- **A8** `contracts/capability.json` `unsupported` contains at least the five real open risks from
  `RELEASE_STATUS.md`.

---

## 7. Verification

```powershell
npm run contracts:gen
npm run contracts:check
node bench/run.ts
npm run build
npm run lint
node scripts/python.mjs -m pytest backend/tests -q
```

---

## 8. Out of scope

- Rewiring `backend/agent.py` or `backend/hardware.py` to load from contracts. That is `v04`.
- The graph implementation. `v03` — this phase only defines and validates its shape.
- Any solver. `v06`.
- Deleting or editing the vendored Velxio component catalogue.

---

## 9. If you are blocked

Stop and report. In particular: if extracting the full kind registry from
`velxioParts.ts` / `component-pins.json` proves impossible in the time available, **do not invent
kinds**. Extract what is mechanically derivable, record the remainder under `GAPS` with counts, and
let `v04`/`v06` extend it. An honest partial registry is correct; a fabricated complete one is a
critical failure under rule 6.

---

## 10. Final report

`docs/phase-reports/v02_contracts.md`, sections: `BASELINE`, `DRIFT` (the §2 findings),
`SCHEMA_SUMMARY` (one short paragraph per contract file), `ACCEPTANCE` table,
`EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.