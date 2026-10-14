# AGENTS.md

Operating contract for any agent or human working in this repository.

## 1. What this product is

WireUp is a simulation platform. You describe a buildable project — a circuit, a boat, a drone,
a website — and the platform assembles it, simulates it, measures it, and hands you back a build
list you can actually make. Real AI agents drive it over MCP. The room, the bench, the laptop, the
water and the sky are views onto one underlying graph.

The product's core promise is **honesty**: if the platform cannot simulate something faithfully, it
says so, and an AI agent is structurally unable to claim otherwise. Every change either strengthens
that promise or weakens it. Never the second.

## 2. Read-first rule

**Read `contracts/` before you read source.** If a schema exists, it is truth and the code
conforms to it. Never infer an API shape by reading an implementation — read the contract, then
verify the implementation matches.

Phase briefs live in `prompts/`. They are final specifications, not suggestions. Read
`prompts/v00_MASTER_PLAN.md` before any phase brief.

## 3. Architecture map

```
wireup/
├─ contracts/              machine-readable, versioned, test-enforced shapes
│  ├─ graph.schema.json        nodes, edges, ports, the universal project model
│  ├─ port-types.json          the type system for ports and edges
│  ├─ kinds.json               every buildable thing, and whether it is simulated
│  ├─ telemetry.schema.json    measurements, with honest quality tags
│  ├─ capability.json          GENERATED: what the platform can actually do
│  └─ tools/*.tool.json        one per tool; the model reads these, not our code
├─ packages/
│  ├─ core/                    pure domain: no React, no FastAPI, no I/O in graph/
│  │  ├─ contracts/              schema loader + validation + types (v02, planned)
│  │  ├─ graph/                  universal project graph, revisions, undo (v03, planned)
│  │  ├─ telemetry/              telemetry bus, quality, recorder (v05, planned)
│  │  └─ trials/                 sweeps, metrics, verdicts (v05, planned)
│  ├─ toolbus/                THE ONLY MUTATION PATH (v04, planned)
│  └─ solvers/                interchangeable engines behind one interface (v06, planned)
│     ├─ circuit/                ngspice
│     ├─ mcu/                    CPU emulation, headless + browser (v07, planned)
│     ├─ mechanics/              rigid body, buoyancy, aero (v11, planned)
│     ├─ environment/            water, air, weather (v11, planned)
│     └─ software/               sandboxed web apps and scripts (v12, planned)
├─ services/
│  ├─ api/                    FastAPI: projects, tool endpoint, telemetry queries
│  ├─ mcp/                    MCP server over the tool bus (v08, planned)
│  ├─ orchestrator/            headless goal → trials → verdict → build list (v09, planned)
│  ├─ runtime-worker/         sandboxed compile + emulate + step, no browser (v07, planned)
│  └─ sandbox/                software execution isolation (v12, planned)
├─ apps/
│  ├─ room/                   the 3D room: bench, laptop, water, sky (v10, planned)
│  └─ web/                    the application shell (v13, planned)
├─ bench/                    executable specification; a feature is done when its cases pass
├─ docs/
│  ├─ ARCHITECTURE.md         the living system description — the parent document
│  ├─ adr/                    architecture decision records, immutable
│  └─ phase-reports/          one page per phase; read these, not diffs
├─ backend/                  FastAPI service, LangGraph in-app agent, compiler bridge
├─ src/                      React application
└─ prompts/                  the sequenced build plan
```

**Language seam:** TypeScript for graph/toolbus/solvers/UI; Python for the FastAPI service and the
LangGraph agent. The two sides never share in-memory objects — they share `contracts/*.json` and
project JSON on disk.

## 4. Non-negotiable invariants

- **I1 Single mutation path.** Every state change goes through the tool bus. No direct writes from
  UI, HTTP handler or agent. No exceptions.
- **I2 Revision safety.** Every mutation requires `expected_revision`. Stale revision → `409`.
  Never a silent overwrite.
- **I3 Atomicity.** A tool call either fully applies or changes nothing.
- **I4 Bounded undo.** 50 snapshots, matching existing behaviour.
- **I5 Honest telemetry.** Every sample carries `quality` ∈ `measured | derived | assumed |
  unavailable`. An `assumed` sample must never be presented as a measurement.
- **I6 Declared capability.** What is buildable and simulatable is generated from solver
  registration, never hand-maintained.
- **I7 No silent coercion.** Unknown kind, port or edge → explicit error naming the offender.
- **I8 Tokens never leak.** Credentials, runtime tokens and ownership tokens never appear in
  telemetry, exports, errors, logs or tool results.
- **I9 Determinism.** Same graph + same seed → same result. Every solver takes an explicit seed.
- **I10 Degrade, never fake.** An unavailable solver reports `solver_unavailable`. It never
  approximates.

## 5. Change protocol

- One concern per change.
- Run the full verification set (§8) before reporting. Paste real output. If you did not run it,
  write `NOT RUN`.
- Never disable a test to make it pass. Never delete a failing test without a replacement
  assertion of equal or greater strength.
- Never lower a tolerance. If a number is wrong, fix the model, not the assertion.
- Existing behaviour is production. If a user could tell the difference, the change is wrong.
- Every phase ends with `docs/phase-reports/vNN_<name>.md` in the format its brief specifies.

## 6. God-file rule

- No new tracked source file above **800 lines**. Enforced by `scripts/check-file-size.mjs`.
- Editing a file already in `bench/known-oversize.txt` is allowed only if the change does not grow
  it. Extract instead.
- Extraction is preferred to rewriting. Preserve behaviour, preserve import paths.

## 7. Dependency rule

No runtime dependency unless it is listed in the `APPROVED DEPS` section of the phase brief you
are executing. If you believe another is required, put it in the report's `GAPS` and implement
without it. Never add a dependency to make a test pass.

## 8. Verification commands

```powershell
npm install                       # once per checkout
node scripts/python.mjs -m pytest backend/tests -q

npm run build                     # tsc -b && vite build
npm run lint                      # oxlint + file-size + docs checks
npm run contracts:check           # schema + manifest verification (phase v02+)
npm run core:test                 # packages/core unit and property tests (phase v03+)
npm run mcp:smoke                 # headless MCP loop (phase v08+)
npm run acceptance                # end-to-end world acceptance (phase v15+)

npm test -- --workers=1           # Playwright
node bench/run.mjs                 # the executable specification
```

Playwright specs use installed Chrome and software WebGL. Tests needing a live model provider are
marked and skipped in CI; they are not silently green.

## 9. Phase protocol

1. Read `prompts/v00_MASTER_PLAN.md`, then your phase brief, then this file, then the contracts
   your phase touches.
2. Execute the brief exactly. It is final. **Never ask whether something should be improved.**
3. Classify your change: **GREEN** (assertions pass, no contract or dependency or security change),
   **AMBER** (added a node kind, tool or contract field), **RED** (an assertion failed, a contract
   broke, or auth / sandboxing / licensing / spend is involved). State which, and why.
4. Write `docs/phase-reports/vNN_<name>.md`: `BASELINE`, `CHANGES`, `ACCEPTANCE`,
   `EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.
5. Stop. Do not commit. The human commits.

## Never

1. Never implement beyond the brief.
2. Never ask "shall I make this better?"
3. Never modify files outside the brief's file list.
4. Never add a dependency that is not in `APPROVED DEPS`.
5. Never let code contradict a contract — change the code.
6. Never claim a capability that does not exist.
7. Never report a result you did not measure.
8. Never break existing behaviour.
9. Never leave a half-migrated state.
10. Never commit, push, tag or publish.