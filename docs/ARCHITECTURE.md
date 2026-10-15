# WireUp architecture

The parent document. Every other document is subordinate to this one and points back here.

WireUp is a simulation platform: you describe a buildable project, it assembles it, simulates it,
measures it, and returns a build list you can make. AI agents drive it over MCP. The room, the
bench, the laptop, the water and the sky are views onto one underlying graph.

The product's core promise is **honesty**. If the platform cannot simulate something faithfully it
says so, and an agent is structurally unable to claim otherwise. Every change either strengthens
that promise or weakens it.

---

## 1. The one idea

**Everything is a node with typed ports. Everything is an edge. Every edge carries a value or a
force. Every node's behaviour comes from a solver that declares what it can and cannot do.**

- A resistor is a node with two ports, solved by `circuit`.
- A motor is a node solved by `circuit` *and* `mechanics`, bridged by an actuator.
- A hull is a node solved by `mechanics`, driven by `env.water_body`.
- A web app is a node solved by `software`, living inside a `computer` node.

Adding a domain means adding node kinds and a solver. It never means forking the project model.
This is why the electronics simulator is the *first* domain and not a special case.

---

## 2. Layers

```
                       external AI agents (Claude Code, Codex, …)
                                     │  MCP
                       ┌─────────────▼──────────────┐
                       │      services/mcp          │  v08
                       │   tools from contracts/    │
                       └─────────────┬──────────────┘
                                     │
   ┌─────────────────────────────────▼──────────────────────────────────┐
   │                     packages/toolbus                            │  v04
   │        THE ONLY MUTATION PATH — UI, agent and MCP share it      │
   └─────────────────────────────────┬──────────────────────────────────┘
                                     │
   ┌─────────────────────────────────▼──────────────────────────────────┐
   │                        packages/core                             │  v02 v03 v05
   │  graph (Node/Edge/Port) · store (revision, tx, undo)            │
   │  telemetry (bus, quality, recorder) · trials (sweep, verdict)    │
   └──┬───────────────────────┬───────────────────────┬───────────────┘
      │                       │                       │
┌─────▼──────┐         ┌──────▼───────┐        ┌──────▼──────────┐
│  solvers   │         │  telemetry   │        │ capability.json │
│  circuit   │         │  + trials    │        │ GENERATED       │
│  mcu       │         │              │        │ what we can do  │
│  mechanics │         └──────────────┘        └─────────────────┘
│  environment│
│  software  │        ┌────────────────────────────────────┐
└─────┬──────┘        │  apps/room (3D)   apps/web (2D)   │
      │               └────────────────────────────────────┘
┌─────▼──────────────────────────────────────────────┐
│  services/runtime-worker — sandboxed compile +     │
│  emulate + step, headless, no browser required     │
└────────────────────────────────────────────────────┘
```

**Language seam.** TypeScript for graph, toolbus, solvers and UI. Python for the FastAPI service
and the LangGraph in-app agent. The two sides never share in-memory objects — they share
`contracts/*.json` and project JSON on disk. This is deliberate: it keeps a slow Python import off
the UI frame.

---

## 3. Contracts before code

`contracts/` is the source of truth for every shape:

| File | Defines |
|---|---|
| `graph.schema.json` | Node, Edge, Port, Project — the universal model |
| `port-types.json` | which ports may connect, and what they carry |
| `kinds.json` | every buildable thing, and whether it is simulated |
| `telemetry.schema.json` | measurements, with honest quality tags |
| `derivations.json` | how each derived channel is computed |
| `trial.schema.json` | goals, sweeps, verdicts |
| `capability.schema.json` | the declaration of what the platform can do |
| `tools/*.tool.json` | one per tool — args, result, errors, cost |

An agent reads `contracts/`, never our source. Schemas are versioned, hashed in
`contracts/manifest.json`, and verified in CI. **If code and contract disagree, the contract wins.**

---

## 4. Honesty is enforced, not promised

Three mechanisms, all mechanical:

1. **Quality tags.** Every telemetry sample is `measured`, `derived`, `assumed` or `unavailable`.
   A derived channel must name its formula in `contracts/derivations.json` or the recorder rejects
   it. An `unavailable` sample must have a null value.
2. **Generated capability.** `contracts/capability.json` is produced from what solvers actually
   register and what tests actually pass. A solver cannot mark itself verified — `confidence` is
   computed from the CI test report and the solver's own self-test.
3. **Solver unavailability is an answer, not a failure.** `SOLVER_UNAVAILABLE` returns the exact
   `requiredToSupport` text. It never approximates.

These are what let an agent be trusted. Without them, an AI that reads "9,357 parts" believes it
can build anything, and the platform's entire value proposition collapses.

---

## 5. The bench is the specification

`bench/cases/<domain>/<case>/` holds `case.json`, `project.json`, `spec.md` and `assertions.json`.
**A feature is not done until its assertions pass.** `node bench/run.mjs` runs them and writes
`bench/results/testreport.json`, which the capability generator reads.

Assertion kinds: `no_error`, `equals`, `within`, `telemetry_max`, `telemetry_mean`,
`bom_total_within`, `capability_declared`, `artifacts_exist`.

`capability_declared` assertions matter as much as the positive ones: a platform that correctly
says *"I cannot simulate hull hydrodynamics at this Reynolds number"* passes.

---

## 6. Escalation

Every phase classifies its own diff:

- **GREEN** — assertions pass, no contract/dependency/security change. Merge without review.
- **AMBER** — assertions pass but a node kind, tool or contract field was added. Human reviews a
  one-page delta, not a diff.
- **RED** — an assertion failed, a contract broke compatibly, or auth/sandboxing/licensing/spend
  is involved. Stop and ask one specific question.

This is how a human stays in the loop without being the bottleneck: ~10 minutes a day on AMBER,
near zero on GREEN, and never a silent merge.

---

## 7. Current state

Read `docs/phase-reports/` for what was actually built and verified, in order. Read
`RELEASE_STATUS.md` for the honest short list of what is not ready.

The v03 graph core and a v04 tool-bus foundation are present. The v04 report records the
remaining integration and parity gaps; this foundation is not yet the application's authoritative
mutation path. Initial v05 telemetry and trial primitives exist, but the phase report records
their unverified state and missing ToolBus integration. The local MCP server is a separately
documented bridge to the existing electronics API, not the completed v08 transport over the tool
bus. A partial `/room/:projectId` view renders saved electronics projects and can query an already
connected browser MCU runtime from a focused component page; it does not start a simulation or
provide vehicle physics, validated motor CAD, or software execution. The v06 capability generator
now derives a conservative declaration from registered solver manifests, the current bench report,
and component/release limitations. Browser circuit and MCU claims remain partial until their
solver adapters are integrated with the ToolBus and their tests appear in the bench report.
Headless runtime, orchestration, mechanics, software and human review remain governed by their
phase reports and contracts; no vehicle or website capability should be inferred from the room.

---

## 8. What is deliberately not here

- No claimed physics fidelity without declared derivations. Approximations are listed in the
  phase report's `APPROXIMATIONS` section and in `contracts/derivations.json`.
- No fabricated prices, availability or lead times.
- No network egress from sandboxes without an explicit allowlist.
- No capability claim without a passing test.

## Subordinate documents

- `RELEASE_STATUS.md` — short honest readiness list (repo root)
- `docs/SIMULATION_INTEGRATION_BACKLOG.md` — per-part simulation inventory
- `docs/VELXIO_EXAMPLE_FINDINGS.md` — analysis of the 321 upstream examples
- `docs/COMPONENT_SIMULATION_AVAILABILITY.md` — which parts actually simulate
- `docs/adr/` — immutable architecture decision records
- `docs/phase-reports/` — one report per phase, in build order
- `prompts/` — the sequenced build plan