# Phase v05 — Telemetry and trials

## BASELINE

- Branch: `v2`.
- The repo already exposed runtime, ngspice, and hardware simulation-result measurements through separate paths.
- `contracts/capability.json` is still generated as a stub and does not declare `limits.max_telemetry_samples`.
- The user requested code changes only; no tests, builds, or benchmarks were run for this continuation.
- The earlier requested `npm run dev` had started the API and Vite successfully, but Vite later exited with a fatal out-of-memory error; the API was then terminated by `concurrently`.

## CHANGES

- `contracts/telemetry.channels.json` — initial runtime, MCU, and ngspice channel catalogue.
- `contracts/derivations.json` — runtime-time and query mean-downsample formulas.
- `packages/core/telemetry/bus.mjs` — bounded ring buffer, queries, backpressure accounting, and downsampling.
- `packages/core/telemetry/index.mjs` — telemetry public exports.
- `packages/core/telemetry/recorder.mjs` — gzipped NDJSON recordings, graph hashes, and integrity-aware reads.
- `packages/core/trials/index.mjs` — trial public exports.
- `packages/core/trials/metrics.mjs` — metric functions and rise/fall threshold correction.
- `packages/core/trials/probes.mjs` — bounded expression parser and per-probe execution.
- `packages/core/trials/runner.mjs` — dependency-injected sweep runner, goal verdicts, cancellation, and recording integrity checks.
- `bench/cases/meta/telemetry/case.json` — v05 bench case metadata.
- `bench/cases/meta/telemetry/spec.md` — acceptance case description.
- `bench/cases/meta/telemetry/assertions.json` — registered A1–A10 checks.
- `bench/cases/meta/telemetry/check.mjs` — executable checks using deterministic fake solver services.
- `docs/ARCHITECTURE.md` — v05 partial status.
- `docs/phase-reports/v05_telemetry_trials.md` — v05 results and known gaps.

## CHANNEL_CATALOGUE

- Measured from solvers: 7 — `pin.edge`, `pin.level`, `serial.rx`, `mcu.cycles`, `mcu.clock_hz`, `analog.node_voltage`, `analog.branch_current`.
- Derived: 1 — `runtime.simulated_time`.
- Unavailable: 2 — `pin.duty_cycle`, `pin.avg_voltage`.
- Catalogue metadata remains an initial inventory; it has not been reconciled by running the contract generator or the bench.

## METRICS

- Implemented the metric functions named by the phase brief.
- Hand-computed expected values and tolerance comparisons: **NOT RUN**. No measured values are claimed in this report.

## ACCEPTANCE

| Assertion | Result |
|---|---|
| A1 — Metric values against closed-form cases | Checker authored; **NOT RUN** |
| A2 — Insufficient metrics and goal error verdict | Implemented in code; **NOT RUN** |
| A3 — Quality/derivation and unavailable-value enforcement | Recorder validation is present; **NOT RUN** |
| A4 — Byte-identical recording determinism | Checker runs ten identical fixed-seed trials with isolated buses/recorders; **NOT RUN** |
| A5 — Bounded memory and overflow accounting | Ring buffer and dropped counters are implemented; capability limit is absent and **NOT RUN** |
| A6 — Truncation is surfaced and invalidates verdicts | Trial runner now drains and verifies each completed recording before computing a verdict; checker authored; **NOT RUN** |
| A7 — Cartesian sweep order and isolated solver failures | Sequential sweep machinery is present; **NOT RUN** |
| A8 — Cancellation returns partial error results | Partial cancellation output is implemented; the trial schema has no `cancelled` run verdict, so canceled runs use `error`; **NOT RUN** |
| A9 — Hostile probe-expression corpus | Bounded parser and 40-expression hostile/valid checker authored; **NOT RUN** |
| A10 — Runtime-token exclusion | Checker verifies token rejection and absence from trial result and telemetry query; **NOT RUN** |

## EXISTING_TESTS

- `npm run core:test`: **NOT RUN**.
- `npm run build`: **NOT RUN**.
- `npm run lint`: **NOT RUN**.
- `npm run contracts:check`: **NOT RUN**.
- `node bench/run.mjs`: **NOT RUN**.
- `node scripts/python.mjs -m pytest backend/tests -q`: **NOT RUN**.
- `npm test -- --workers=1`: **NOT RUN**.

## ESCALATION

**RED — incomplete and unverified.** The ToolBus tool contracts for telemetry/trials still have empty argument schemas, and the v05 services and handlers remain stubs. Do not expose these primitives as a completed agent-facing trial capability.

## GAPS

- Integrate telemetry and trial services with ToolBus handlers after the v04 tool contracts expose their exact argument/result shapes.
- The trial runner requires injected solver and metric-selection services; no solver is added in v05.
- Recordings need deterministic identifiers/sequence treatment for byte-identical replays.
- A persistent top-level trial record and `trial.read` lookup/storage are not implemented.
- `capability.json` must be generated with an explicit telemetry sample limit; it must not be hand-edited.
- The existing contract generator does not generate `telemetry.channels.json`; the current derived-channel edits have not been reconciled with generator inputs or the contract manifest.
- Add the v05 executable bench cases and the hand-calculated metric corpus.
- The phase remains unverified at the user's request.

## DEVIATIONS

- Used dependency-free `.mjs` modules, following the existing graph-core conventions.
- Kept the trial engine adapter-injected because the trial contract does not describe metric-to-channel selection and v06 solvers are out of scope.
- Parallel trial execution is rejected unless concurrency is one; shared telemetry/recording isolation is not yet implemented.
