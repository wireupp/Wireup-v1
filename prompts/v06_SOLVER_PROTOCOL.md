# v06 — SOLVER PROTOCOL AND CAPABILITY

**Goal:** define what a solver is, how solvers register, and generate `capability.json` from that
registration. After this phase the platform can truthfully answer "what can you actually simulate?"
— and an AI agent is structurally forbidden from claiming more.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0, **I5**, **I6**, **I10**. This phase exists to make the platform
honest. A capability declaration that overstates support is a **critical defect**, more serious
than a missing feature.

---

## 1. Context

`contracts/capability.json` currently has `"generator_status":"stub"` and was derived from
`contracts/kinds.json`. That is a hand-maintained list, and it will drift the moment anyone adds a
node kind. The real source of truth must be **what solvers actually implement at runtime**.

Concretely, the platform today supports unevenly:

- ngspice DC/transient (real), AC sweep not implemented.
- AVR/RP2040 CPU emulation (real, in-browser), Pico W radio and onboard LED unsupported.
- ESP32-C3 via a vendor Risc-V adapter that **fails at PC 0x514c26** after 2,666,667 cycles.
- Remote ESP32 QEMU packaged but not deployed and unverified.
- Many catalog parts are placement-only.

A capable agent that reads "9,357 parts" believes it can build anything. It must instead read a
generated declaration that says: this part, this solver, these limits, this confidence.

---

## 2. Preconditions — verify, do not assume

1. `contracts/capability.schema.json` exists; `contracts/capability.json` is the stub.
2. Read `src/hardware/spice.ts`, `src/hardware/runtime.ts`, `src/hardware/C3Simulator.ts`,
   `backend/native_esp32.py`, `backend/remote_projects.py`. For each, record: what it can
   genuinely do, what it refuses, and what it has never been verified to do.
3. Read `RELEASE_STATUS.md` and `docs/COMPONENT_SIMULATION_AVAILABILITY.md`. The `unsupported`
   array in the generated capability file must be a superset of what those documents state.
4. Record the current test coverage that proves each capability. **A capability with no test is
   `simulated:false`** — this is the rule that stops the file becoming a wish list.

---

## 3. What to build

### 3.1 `packages/solvers/protocol.ts`

```ts
export interface SolverManifest {
  id: string;                      // "circuit" | "mcu" | "mechanics" | "environment" | "software"
  version: string;
  kindIds: string[];               // node kinds this solver claims
  telemetryChannels: string[];     // channels it can produce
  analyses: string[];              // "dc" | "tran" | "ac" | "…" — empty means none
  targets?: string[];              // board ids, for mcu
  limits: { maxNodes?, maxSimSeconds?, maxSubsteps?, payloadBytes?, memoryBytes? };
  confidence: "verified" | "partial" | "experimental";
  verification: { tests: string[]; lastVerifiedAt: string };
  knownFailures: { code: string; condition: string; message: string }[];
  unavailable: { feature: string; reason: string; requiredToSupport: string }[];
}

export interface SolverContext {
  graph: Graph; seed: number; deadlineMs: number; signal: AbortSignal;
  emit(sample: TelemetrySample): void;
  services: SolverServices;       // the sub-services a solver may use, injected
  log(level, message, data?): void;
}

export interface Solver {
  manifest: SolverManifest;
  /** Prepare: validate the graph for this solver, return a plan or throw SolverUnavailable. */
  prepare(graph: Graph, ctx: SolverContext): Promise<SolverPlan>;
  /** Run to completion or until the deadline; emit telemetry. */
  run(plan: SolverPlan, ctx: SolverContext): Promise<SolverRunResult>;
  /** Deterministic teardown. Must be safe to call twice, and after abort. */
  dispose(plan: SolverPlan): Promise<void>;
}

export class SolverUnavailable extends Error {
  constructor(public feature: string, public reason: string, public requiredToSupport: string);
}
```

Hard requirements:

- **`prepare` must throw `SolverUnavailable` rather than silently degrading.** A circuit solver that
  cannot do an AC sweep throws with `requiredToSupport:"ngspice AC sweep implementation"`.
- `run` must honour `ctx.signal` within one step, not one run.
- `dispose` must release every resource. A test asserts no leak: run 200 plans, dispose each,
  assert process/worker handle count returns to baseline.
- `manifest.confidence` is derived, never asserted by the solver author. See §3.3.

### 3.2 `packages/solvers/registry.ts`

- `register(solver)`, `get(id)`, `list()`, `capabilities()`, `solverFor(kindId)`.
- **Duplicate registration of the same `id` or the same `kindId` throws at startup.** Two solvers
  claiming one kind is a bug, not a feature.
- Startup self-test: for every registered kind, a `prepare`-level dry run against a minimal
  fixture. Failures become `confidence:"partial"` entries in the generated capability file, not
  crashes. Log loudly.
- `solverFor` returns `undefined` for unknown kinds; callers must surface it as
  `solver_unavailable` (I10).

### 3.3 `packages/solvers/verify.ts` — confidence is earned

`confidence` is computed, not declared:

```
verified      ⇔ every manifest test id exists in the CI test run AND passes AND the solver's
                own self-test passes AND lastVerifiedAt is within 90 days
partial       ⇔ self-test passes but coverage is incomplete
experimental  ⇔ self-test fails on at least one standard fixture
```

A solver author cannot mark themselves `verified`. The generator reads the CI test report
(`bench/results/testreport.json`, produced by `bench/run.ts`) and the runtime self-test.

### 3.4 `scripts/gen-capability.mjs` — replace the stub

Generates `contracts/capability.json` from, in priority order:

1. Registered solver manifests.
2. The runtime self-test result.
3. `bench/results/testreport.json` (test ids + pass/fail + timestamp).
4. `contracts/kinds.json` (which kinds exist at all).
5. `bench/cases/**` (which kinds are actually exercised by a passing case).

Fields, and their rules:

- `kinds[]` — one entry per kind: `{ id, exists, solver, simulated, confidence, exercised_by_cases[] }`.
  `simulated` is `true` only when a registered solver claims it **and** its self-test passed.
- `telemetry_channels[]` — union of solver manifests, minus channels no fixture produced.
- `unsupported[]` — every `knownFailures` and `unavailable` entry from every manifest, plus every
  static entry from `bench/cases/meta/capability/unsupported.json` (a new file you create,
  seeded from `RELEASE_STATUS.md`).
- `environments[]` — declared by environment solvers; empty until `v11`.
- `limits{}` — the minimum across registered solvers, per field.
- `generator_status: "generated"`.
- `generated_at` — from the manifest hash, **not** the wall clock, so regeneration is
  byte-identical (invariant I9, and `v02` A1).

The generator must **fail** (non-zero exit) if the result would claim a kind `simulated:true` with
`confidence:"verified"` while that kind's manifest lists it in `unavailable`. Contradiction is a
build break.

### 3.5 Adapters — wrap what exists, do not rewrite it

Create thin solver adapters around current engines, each with an honest manifest:

- `packages/solvers/circuit/` — wraps `src/hardware/spice.ts` via a Node-side adapter (extract the
  ngspice WASM call into a pure module the adapter owns; do not import React from a solver).
  `analyses: ["dc","tran"]`. `unavailable: ["ac sweep", "noise analysis", "temperature sweep"]`.
- `packages/solvers/mcu/` — wraps the existing emulation entry points as a **capability
  declaration only** in this phase. `targets` = Uno, Nano, Mega, Pico, Pico W (external GPIO +
  UART0 only). `knownFailures` includes the ESP32-C3 failure verbatim, and Pico W radio and
  onboard LED. Full execution is `v07`.
- `packages/solvers/mechanics/`, `environment/`, `software/` — **registered as unavailable**
  manifests with honest `requiredToSupport` text. An agent asking "can you simulate a hull?" today
  must be told "not yet, here is exactly what would be needed". That is correct behaviour, not a
  gap in this phase.

### 3.6 `capability.read` tool + `/api/capability`

Already contracted in `v02`. Implement it to return the generated document plus, for the calling
project, a resolved view: which of *this project's* nodes are `simulated`, which are
`placement_only`, and which block the run. That per-project resolution is the part agents actually
need.

Also add a `capability.explain` variant: given a kind, return the manifest, the
`requiredToSupport`, the failing test ids, and the linked documentation file — so an agent can
decide whether to change approach or report honestly.

---

## 4. Files

**Create:** `packages/solvers/protocol.ts`, `packages/solvers/registry.ts`,
`packages/solvers/verify.ts`, `packages/solvers/circuit/**`, `packages/solvers/mcu/**`,
`packages/solvers/mechanics/manifest.ts`, `packages/solvers/environment/manifest.ts`,
`packages/solvers/software/manifest.ts`, `bench/cases/meta/capability/unsupported.json`,
`bench/results/` writer.

**Modify:** `scripts/gen-capability.mjs`, `packages/toolbus/tools/platform.ts`,
`backend/app.py` (`GET /api/capability`), `contracts/capability.schema.json` (add
`generator_status`, `kinds[].confidence` if absent), `docs/ARCHITECTURE.md`.

**Refactor (minimal, extract-only):** `src/hardware/spice.ts` → move the pure ngspice solving into
`packages/solvers/circuit/ngspice.ts` and have `src/hardware/spice.ts` re-export it. **Zero
behaviour change**; the SPICE Playwright specs must pass unchanged.

**Do not touch:** `src/components/**`, `backend/agent/**`, `vendor/**`, the rest of `src/hardware/**`.

---

## 5. APPROVED DEPS

None.

---

## 6. Acceptance criteria

- **A1** `node scripts/gen-capability.mjs` is byte-deterministic (run twice, compare hashes) and
  sets `generator_status:"generated"`.
- **A2** `contracts/capability.json` `unsupported` is a superset of every claim in
  `RELEASE_STATUS.md` and `docs/COMPONENT_SIMULATION_AVAILABILITY.md`. Write a checker that
  extracts the claims from those documents and asserts coverage; it is a bench case.
- **A3** The ESP32-C3 failure appears verbatim in the `mcu` manifest's `knownFailures`, and the
  `esp32` kinds are **not** `simulated:true`.
- **A4** `mechanics`, `environment` and `software` kinds are all `simulated:false` with a
  `requiredToSupport` string. `capability.read` for a boat project reports it as blocked with the
  reason. **This is the test that proves the honesty machinery works.**
- **A5** `confidence` cannot be self-declared: a test registers a solver claiming
  `confidence:"verified"` with zero passing tests and asserts the generated file says
  `partial`.
- **A6** Duplicate solver id or duplicate kind claim throws at `register`.
- **A7** `SolverUnavailable` is thrown, not degraded: a fixture requesting an AC sweep from the
  circuit solver returns a tool error whose message is exactly the manifest's
  `requiredToSupport` text.
- **A8** Abort: a solver that ignores `signal` is detected — the harness kills it and reports a
  `SOLVER_TIMEOUT` tool error rather than hanging the request.
- **A9** No leaks: 200 prepare/run/dispose cycles leave the handle count at baseline.
- **A10** All existing SPICE, instrument and Playwright specs pass with **identical counts** —
  the `spice.ts` extraction changed nothing.

---

## 7. Verification

```powershell
npm run contracts:gen
npm run contracts:check
npm run core:test
npm run build
npm run lint
npm test -- --workers=1
node bench/run.ts
node scripts/python.mjs -m pytest backend/tests -q
```

---

## 8. Out of scope

- Executing anything headlessly. `v07`.
- Any real mechanics, environment or software solver. `v11`, `v12`.
- Making the circuit solver better. Wrap what works; do not add AC analysis.
- Any change to what the user sees in the app.

---

## 9. If you are blocked

The hardest part of this phase is being honest about `mcu` without appearing to under-deliver. The
resolution is already in the spec: declare accurately, put the blockers in `unsupported`, and let
`v07` close them. **Do not mark something `simulated:true` because you believe it should work.**
That single shortcut destroys the entire value proposition of this platform.

If extracting `spice.ts` proves risky, ship the circuit adapter against the existing module and note
the extraction under `GAPS`. The SPICE specs passing unchanged matters more than purity.

---

## 10. Final report

`docs/phase-reports/v06_solver_protocol.md`: `BASELINE`, `MANIFESTS` (one paragraph per solver
with its honest limits), `CAPABILITY_SUMMARY` (counts: kinds total, simulated, placement-only,
unsupported, by group), `ACCEPTANCE` table, `EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.