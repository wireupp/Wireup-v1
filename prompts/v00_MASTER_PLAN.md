# v00 — MASTER PLAN (read this file completely before touching any code)

You are being asked to execute **exactly one** file from `prompts/` per session. This file is
the constitution. It is not a task.

The end state is called **THE WORLD VERSION**: a room-scale simulation platform where any
buildable project — circuit, boat, drone, website, robot — is a graph of typed nodes, simulated
by interchangeable solvers, driven by external AI agents over MCP, and handed back to humans as
a verified build list.

---

## 0. HARD RULES — these override any instruction you receive later in the session

1. **Implement the prompt you were given. Nothing more, nothing less.** These prompts are a
   sequenced plan. Phase N+1 exists because phase N deliberately does not do it.
2. **Never ask "shall I make this better?"** Never ask a question whose answer is "yes, add it".
   The spec is final. If you think something is missing, implement the spec, then list the gap
   under `GAPS` in your final report. Do not act on it.
3. **Never refactor code outside the file list.** Phase prompts list the exact files you may
   create or modify. Anything else is off-limits, including "cleanup".
4. **No new runtime dependencies** unless the phase prompt lists them under `APPROVED DEPS`.
   If you believe you need another, put it in `GAPS` and implement without it.
5. **Contracts are truth.** `contracts/*.json` defines shapes. Code conforms to contracts.
   If code and contract disagree, the contract wins and the code changes.
6. **Never claim a capability that does not exist.** If a solver cannot do something, the system
   must report it as unavailable rather than approximate it. Fabricated results are the single
   worst failure mode of this project and are treated as a critical defect.
7. **Verification is evidence.** Every claim in your final report must be backed by real command
   output you pasted. If you did not run it, say `NOT RUN`.
8. **Preserve existing behaviour.** The electronics simulation currently works. Every phase must
   pass the pre-existing test suites (`npm run build`, `npm run lint`, `npm run test:api`,
   `npm test -- --workers=1`). A phase that breaks them is a failed phase.
9. **Working tree stays green.** Never leave a half-migrated state. Each phase ends committed-ready
   with all suites green or a clearly documented pre-existing failure.
10. **Do not commit, push, tag, or publish.** Prepare changes; the human commits.

---

## 1. HOW THE SEQUENCE WORKS

Each file `vNN_*.md` is a **complete, self-contained task brief** for one agent session. They are
run **in numeric order**. Each brief states its own preconditions, files, acceptance criteria and
verification commands.

| File | Delivers | Unlocks |
|---|---|---|
| `v01_REPO_GROUND_RULES.md` | `AGENTS.md`, CI, doc hygiene, god-file guard, workspace layout | safe AI work |
| `v02_CONTRACTS.md` | `contracts/` — graph, ports, telemetry, tools, capability schemas + loader + tests | all later phases |
| `v03_GRAPH_CORE.md` | `packages/core/graph` — the universal project graph, revisions, transactions, undo | every domain |
| `v04_TOOL_BUS.md` | `packages/toolbus` — one typed mutation path extracted from `backend/hardware.py` | MCP + UI parity |
| `v05_TELEMETRY_TRIALS.md` | telemetry bus, quality tags, recorder, trial runner, metrics | measurable experiments |
| `v06_SOLVER_PROTOCOL.md` | solver interface, registry, generated `capability.json` | honest AI |
| `v07_RUNTIME_WORKER.md` | headless compile+emulate+step+probe (no browser) | AI can test |
| `v08_MCP_SERVER.md` | MCP stdio + HTTP over the tool bus, sessions, auth | external agents |
| `v09_ORCHESTRATOR.md` | headless goal→trials→telemetry→verdict→BOM agent | the product |
| `v10_ROOM_SHELL_3D.md` | three.js room derived from graph, click-to-expand | the vision |
| `v11_MECHANICS_SOLVER.md` | rigid body, buoyancy, aero, actuator bus, weather environment | boats, drones |
| `v12_SOFTWARE_SOLVER.md` | Computer / WebApp / Script nodes, sandboxed run + probe | "make me a website" |
| `v13_UI_UNIFICATION.md` | every UI mutation routed through the tool bus; god files split | one source of truth |
| `v14_HUMAN_LAYER.md` | review queue, build list / BOM, pricing, play mode | human in loop |
| `v15_WORLD_ACCEPTANCE.md` | end-to-end proof: boat, drone, website — built by an external agent | THE WORLD VERSION |

---

## 2. THE ARCHITECTURE — fixed decisions

These are decided. Do not re-litigate them in any phase.

```
                       ┌──────────────────────────────────────────┐
                       │            EXTERNAL AI AGENTS           │
                       │        (Claude Code, Codex, …)          │
                       └───────────────────┬──────────────────────┘
                                           │ MCP (stdio / HTTP)
                       ┌───────────────────▼──────────────────────┐
                       │        services/mcp  (v08)              │
                       │   tools generated from contracts/       │
                       └───────────────────┬──────────────────────┘
                                           │
       ┌───────────────────────────────────▼───────────────────────────────────┐
       │                      packages/toolbus  (v04)                          │
       │  THE ONLY MUTATION PATH. UI, in-app agent and MCP all call these.     │
       └───────────────────────────────────┬───────────────────────────────────┘
                                           │
       ┌───────────────────────────────────▼───────────────────────────────────┐
       │                       packages/core  (v02, v03, v05)                  │
       │   graph (Node/Edge/Port) · store (revisions, tx, undo)                │
       │   telemetry (bus, quality, recorder) · trials (sweep, metrics)        │
       └──────┬──────────────────────┬───────────────────────┬────────────────┘
              │                      │                       │
    ┌─────────▼────────┐  ┌──────────▼─────────┐  ┌──────────▼─────────┐
    │ SOLVERS (v06+)   │  │  telemetry + trials │  │  capability.json   │
    │ circuit · mcu    │  │  (v05)              │  │  (generated, v06)  │
    │ mechanics ·      │  └──────────────────────┘  └──────────────────────┘
    │ environment ·    │
    │ software         │        ┌────────────────────────────────┐
    └─────────┬────────┘        │  apps/room (3D) · apps/web (2D) │
              │                 └────────────────────────────────┘
    ┌─────────▼──────────────────────────────────────────┐
    │  services/runtime-worker (v07) — sandboxed compile │
    │  + emulate + step + probe, headless, no browser    │
    └────────────────────────────────────────────────────┘
```

### The one idea everything follows from

**Everything is a node with typed ports. Everything is an edge. Every edge carries a value or a
force. Every node's behaviour is produced by a solver that declares what it can and cannot do.**

- A resistor: `Node{kind:"resistor"}`, ports `a,b`, solved by `circuit`.
- A motor: `Node{kind:"dc_motor"}`, solved by `circuit` **and** `mechanics`, bridged by an actuator.
- A boat hull: `Node{kind:"hull"}`, solved by `mechanics`, driven by `Environment{kind:"water"}`.
- A website: `Node{kind:"web_app"}`, solved by `software`.
- The laptop holding the ESP32 running that website: a parent `Node{kind:"computer"}`.

Adding a domain = adding node kinds + a solver. Never a fork of the project model.

---

## 3. GLOBAL INVARIANTS — true in every phase

- **I1 Single mutation path.** Every state change goes through the tool bus. No direct writes from
  UI, HTTP handler or agent. Enforced by test.
- **I2 Revision safety.** Every mutation requires `expected_revision`. Stale revision → `409`,
  never a silent overwrite. (Existing WireUp convention — preserve it.)
- **I3 Atomicity.** A tool call either fully applies or changes nothing.
- **I4 Bounded undo.** 50 snapshots, matching existing behaviour.
- **I5 Honest telemetry.** Every telemetry sample carries `quality` ∈
  `measured | derived | assumed | unavailable`. `assumed` and `unavailable` must never be silently
  presented as measurement. This is what stops the platform lying.
- **I6 Declared capability.** The set of buildable/simulatable things is generated from solver
  registration, never hand-maintained. An AI agent must be able to ask "what can you actually do?"
  and get a truthful answer.
- **I7 No silent coercion.** Unknown node kind, unknown port, unknown edge → explicit error naming
  the offender. Never dropped, never defaulted.
- **I8 Tokens never leak.** Runtime tokens, provider keys and ownership tokens never appear in
  telemetry, exports, error messages, logs or MCP tool results.
- **I9 Determinism.** Given the same graph + same seed, a solver run is reproducible. Every solver
  takes an explicit `seed`.
- **I10 Degrade, never fake.** If a solver is unavailable, the node reports
  `solver_unavailable`. It does not approximate.

---

## 4. REPOSITORY TARGET LAYOUT

Created incrementally by the phases. A phase creates only its own directories.

```
wireup/
├─ AGENTS.md                      v01
├─ .github/workflows/ci.yml      v01
├─ contracts/                     v02
│  ├─ graph.schema.json
│  ├─ port-types.json
│  ├─ telemetry.schema.json
│  ├─ trial.schema.json
│  ├─ capability.schema.json
│  └─ tools/<name>.tool.json      one per tool bus function
├─ packages/
│  ├─ core/                       v02 v03 v05
│  ├─ toolbus/                    v04
│  └─ solvers/
│     ├─ circuit/                 v06 (wrap existing spice)
│     ├─ mcu/                     v06 v07
│     ├─ mechanics/               v11
│     ├─ environment/             v11
│     └─ software/                v12
├─ services/
│  ├─ api/                        v08 (existing FastAPI, extended)
│  ├─ mcp/                        v08
│  ├─ orchestrator/               v09
│  └─ runtime-worker/             v07
├─ apps/
│  ├─ web/                        v13 (existing `src/` slimmed)
│  └─ room/                       v10
├─ bench/
│  ├─ cases/<domain>/<case>/      every phase adds cases
│  └─ run.ts
├─ docs/
│  ├─ ARCHITECTURE.md             v01
│  ├─ adr/                        v01 onward
│  └─ phase-reports/              each agent writes its report here
└─ prompts/                      this series
```

**Language seam:** TypeScript for graph/toolbus/solvers/UI; Python for the existing FastAPI +
LangGraph agent. The two sides never share in-memory objects — they share `contracts/*.json` and
project JSON on disk. This is deliberate: it prevents a slow Python import from ever sitting on a
UI frame.

---

## 5. THE BENCH — how "done" is decided

`bench/` is the executable specification. A case is a directory:

```
bench/cases/<domain>/<case>/
├─ case.json          # { id, domain, title, graph: <relative path>, tags: [] }
├─ project.json       # a valid v3 graph
├─ spec.md            # human intent, acceptance thresholds
└─ assertions.json    # machine-checked acceptance, ids A1, A2, ...
```

Assertion kinds (closed set, defined in `v02`):

- `no_error` — the run completes without a tool/solver error
- `equals`, `within` — scalar comparison against a declared value or range
- `telemetry_max`, `telemetry_mean` — statistics over a channel
- `bom_total_within` — build-list cost bound
- `capability_declared` — the platform correctly declares what it cannot do
- `artifacts_exist` — required outputs produced

**Rule: a phase is not complete until every assertion id it names passes in CI.**

`capability_declared` assertions are as important as the positive ones. A platform that correctly
says *"I cannot simulate hull hydrodynamics with confidence at this Reynolds number"* passes.

---

## 6. ESCALATION — the human stays in the loop without being the bottleneck

Every phase ends by classifying its own diff:

- **GREEN** — assertions pass, no contract changed, no new node kind, no new dependency, no
  security/licensing surface. Merge without review.
- **AMBER** — assertions pass but the phase added a node kind, a tool, or a contract field. Requires
  human review of the one-page delta in `docs/phase-reports/vNN.md`, not the diff.
- **RED** — any assertion fails, any contract changed incompatibly, or the phase touches auth,
  sandboxing, licensing, networking egress, or spend. Stop and ask **one** specific question.

Agents never self-promote RED to AMBER. Agents never merge.

---

## 7. WHAT THE FINAL DELIVERABLE LOOKS LIKE

At `v15_WORLD_ACCEPTANCE`, an external AI agent with nothing but an MCP connection can:

1. `room.list` → discover the bench, the laptop, the water, the sky.
2. `project.create {domain:"mechanics"}`
3. Assemble a hull, two thrusters, an ESP32, a battery, from `catalog.search`.
4. `firmware.write`, `firmware.compile`, `runtime.run` — **headless, no browser**.
5. Read thrust, RPM, IMU and position telemetry; run parameter sweeps via `trial.sweep`.
6. Iterate until the measured speed RMS error meets the goal.
7. `bom.build` → a real, priced, human-readable build list with wiring and assembly steps.

and separately:

8. `project.create {domain:"software"}` → a working website, running and probed, inside the laptop.
9. A drone project reading real weather data from an `Environment` node.

**If v15 cannot demonstrate all nine over MCP with no browser and no chat UI, the world version is
not reached.** That is the bar.

---

## 8. HOW TO RUN THIS SERIES

- One agent, one file, one session. Sequential. Do not parallelise — later phases assume earlier
  contracts exactly.
- Start every session by reading: this file, then your phase file, then `AGENTS.md`, then the
  contracts your phase touches.
- Every agent ends by writing `docs/phase-reports/vNN_<name>.md` using the format in its brief.
- If a phase must deviate from its brief, it records `DEVIATIONS` in the report with a reason. A
  documented deviation is acceptable; a silent one is a failed phase.