# Prompts — build sequence for the WireUp world version

Sixteen briefs. Run them **in order**, one agent per session. Each is self-contained: give an agent
exactly one file plus its own context, and nothing else.

**Start with `v00_MASTER_PLAN.md`.** It is the constitution — global invariants, the architecture
decisions, the bench (how "done" is decided), and the escalation model. Every other brief assumes
it has been read.

| # | File | What it delivers |
|---|---|---|
| 00 | `v00_MASTER_PLAN.md` | Read first. Architecture, invariants, bench, escalation. Not a task. |
| 01 | `v01_REPO_GROUND_RULES.md` | `AGENTS.md`, CI, doc hygiene, god-file guard, first extractions |
| 02 | `v02_CONTRACTS.md` | `contracts/` — graph, ports, telemetry, tools, capability + loader |
| 03 | `v03_GRAPH_CORE.md` | `packages/core/graph` — the universal project graph |
| 04 | `v04_TOOL_BUS.md` | `packages/toolbus` — the single mutation path |
| 05 | `v05_TELEMETRY_TRIALS.md` | telemetry bus, metrics, recorder, trials, probes |
| 06 | `v06_SOLVER_PROTOCOL.md` | solver interface + generated, honest `capability.json` |
| 07 | `v07_RUNTIME_WORKER.md` | headless compile + emulate + step + probe (no browser) |
| 08 | `v08_MCP_SERVER.md` | the MCP server — **the loop closes here** |
| 09 | `v09_ORCHESTRATOR.md` | headless goal → trials → verdict → build list |
| 10 | `v10_ROOM_SHELL_3D.md` | the 3D room: bench, laptop, water, sky |
| 11 | `v11_MECHANICS_SOLVER.md` | rigid body, buoyancy, aero, actuators, weather |
| 12 | `v12_SOFTWARE_SOLVER.md` | Computer / WebApp / Script nodes, sandboxed, probed |
| 13 | `v13_UI_UNIFICATION.md` | every UI mutation on the bus; god files split |
| 14 | `v14_HUMAN_LAYER.md` | review queue, build list, play mode |
| 15 | `v15_WORLD_ACCEPTANCE.md` | end-to-end proof — the world version reached or not |

## How to run one

> Read `prompts/v00_MASTER_PLAN.md`, then `prompts/vNN_<NAME>.md`, then `AGENTS.md`. Execute the
> phase brief exactly. Do not ask whether anything should be improved. Write your report to
> `docs/phase-reports/vNN_<name>.md` in the format the brief specifies.

Each brief ends with a fixed report format, so a reviewer reads one page per phase and never has
to read a diff.

## The three rules that make this work

1. **Contracts over prose.** Agents read `contracts/`, never source. Schemas are truth; code conforms.
2. **The bench is the spec.** Every phase ships executable assertions. Green/green/red — no opinion.
3. **Honest capability.** Anything the platform cannot simulate is declared, and an agent is
   structurally unable to claim otherwise. This is the product.

## If a phase fails

Read its report. Fix in the owning phase. Do not relax an assertion and do not continue past a RED.
A documented deviation is acceptable; a silent one is not.