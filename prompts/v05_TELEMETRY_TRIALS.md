# v05 — TELEMETRY AND TRIALS

**Goal:** turn the platform from "it animates" into "it measures". One telemetry shape, one honest
quality tag, one recorder, one trial runner that can sweep parameters and return a verdict.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0 and §3 apply — especially **I5 honest telemetry** and **I9
determinism**. If a number cannot be measured, it is `unavailable`. It is never interpolated,
smoothed into looking real, or invented.

---

## 1. Context

The platform already produces real data in three disconnected places:

- `src/hardware/runtime.ts` — pin edges, serial, ADC readings, used by the oscilloscope and
  logic analyser.
- `src/hardware/spice.ts` — real ngspice samples, DC and transient.
- `backend/hardware/commands.py` `read_simulation_results` — acknowledged runtime results.

None of it is queryable, comparable across runs, or attached to an experiment. An AI agent cannot
ask "does this hull reach 1.2 m/s ±5% over 20 runs". Without this phase, the orchestrator in `v09`
has nothing to optimise against.

---

## 2. Preconditions — verify, do not assume

1. `contracts/telemetry.schema.json`, `contracts/derivations.json`, `contracts/trial.schema.json`
   exist and `npm run contracts:check` passes.
2. `packages/toolbus` exposes `ToolServices.telemetry` and `ToolServices.trials` as stub
   interfaces (from `v04` §3.2). Read the exact signatures you must satisfy.
3. Read `src/hardware/runtime.ts` and enumerate every distinct measurement it can produce. Write
   that list into `contracts/telemetry.schema.json`'s channel catalogue (see §3.2).
4. Read `src/components/hardware-instruments.tsx` to see how those measurements are displayed
   today — the channel names you define must map onto them so existing UI keeps working.

---

## 3. What to build — `packages/core/telemetry/` and `packages/core/trials/`

### 3.1 `bus.ts` — `TelemetryBus`

A fast, bounded, in-process pub/sub. Not a network service.

- `publish(sample: TelemetrySample)` — validates via `contracts` loader (rejecting invalid samples
  loudly), assigns `seq` monotonically, timestamps with the injected clock.
- `subscribe(filter: { projectId?, trialId?, node?, channel?, sinceSeq? }, handler)`
- `query(q: TelemetryQuery): TelemetrySeries[]` with `TelemetryQuery = { projectId, trialId?,
  channels?, nodes?, tFrom?, tTo?, maxSamples?, downsample?: "none"|"minmax"|"mean" }`.
- Bounded memory: a ring buffer per (project, trial) with a configurable cap from
  `contracts/capability.json` `limits.max_telemetry_samples`. On overflow, drop oldest and set a
  `dropped` counter that is **surfaced in every query result**. Silent truncation is forbidden.
- Backpressure: a slow subscriber drops and increments its own counter. Never block a solver.

### 3.2 `channels.ts` — the channel catalogue

Generate `contracts/telemetry.channels.json` from the §2 inventory: every channel the current
platform can produce, with `{ id, label, unit, node_kinds[], direction, min_rate_hz, quality,
source, derivations[] }`.

Rules:
- `source` is either `"solver"` (a solver measured it) or `"derived"` (computed).
- Every `derived` channel must list a `contracts/derivations.json` entry.
- Channels that exist in the UI but are not actually produced anywhere must be listed with
  `quality:"unavailable"` and an empty `source`, so an agent learns the truth. Do not delete them —
  the UI references them.

### 3.3 `recorder.ts`

Writes a trial's telemetry to disk as **NDJSON, one sample per line**, gzipped, plus a
`meta.json` with `{ trial_id, project_id, graph_revision, firmware_revision, seed, solver_versions,
started_at, ended_at, sample_count, dropped_count, channel_catalogue_hash }`.

- Streaming write, flushed per batch, never buffering a whole run in memory.
- Path: `<persistence root>/trials/<trial_id>/telemetry.ndjson.gz`.
- `readRecording(trialId)` streams back with the same ordering guarantees.
- A recording is the evidence for every claim the platform makes about a run. If a recording is
  missing or truncated, the trial verdict is `error`, not `fail`.

### 3.4 `metrics.ts`

Pure functions over a `TelemetrySeries`:

`mean`, `rms`, `stddev`, `min`, `max`, `peakToPeak`, `meanAbsolute`, `riseTime`, `fallTime`,
`settleTime`, `steadyState` (mean over the last `k` of the window), `integral`, `rate`,
`overshoot`, `timeToFirstCrossing`, `dutyCycle`, `correlation`, `linearFitSlope`, `linearFitIntercept`.

Each returns `{ value: number | null, samples: number, insufficient: boolean }`. **Never return a
number computed from insufficient data** — return `null` with `insufficient:true`, and let the
caller decide. This is I5 in code.

### 3.5 `trials/` — the experiment engine

```
runTrial(graph, goal, parameters, envOverrides, seed, services): Promise<Trial>
```

Sequence:

1. Deep-clone the graph; apply `envOverrides`; record the resulting revision and hash.
2. Validate parameter space against `contracts/kinds.json` properties. Reject a sweep that would
   exceed `capability.json` `limits`.
3. For each parameter combination (deterministic ordering, not `Object.keys` order), for each
   repeat (seeds derived as `seed + runIndex`, never random):
   a. Build the solver input; invoke the solver(s).
   b. Stream telemetry into the recorder.
   c. On solver error: record `verdict:"error"` with the error code, continue to the next run.
   d. On completion: compute every metric needed for `goal`.
4. Compute the verdict **only** from `goal`: `|metric − target| ≤ tolerance` for `target`,
   `metric ≤ tolerance` for `min`, `metric ≥ tolerance` for `max`. If `metric` is `null` →
   `verdict:"error"` with `code:"INSUFFICIENT_DATA"`.
5. `summary` = `{ runs, passes, fails, errors, metric_mean, metric_stddev, wall_ms }`.

`sweepTrial` is the same function with a Cartesian parameter space, executed with a concurrency cap
(default 1 — determinism over speed; make it configurable) and progress events.

**Cancellation:** a deadline or `AbortSignal` stops between runs, marks remaining runs as
`cancelled`, and returns the partial result with `verdict:"error", code:"CANCELLED"`. Partial
results are never reported as pass.

### 3.6 `probes.ts`

A probe is a question asked of a live system during a run: read a pin, read a register, query a
DOM node, get a position. This is the primitive `v07` (runtime), `v11` (mechanics) and `v12`
(software) all implement.

```
interface Probe { id, target: {node?|port?|app?}, expression: string, expect?: {op, value}, timeout_ms }
interface ProbeResult { id, ok, value, unit, quality, error?, at }
```

The expression language is deliberately tiny and non-Turing-complete: literals, identifiers
resolved against a scoped view of the target's state, `+ - * /`, comparisons, and `&& || !`.
**No assignment, no loops, no property traversal into arbitrary objects, no function calls.** Parse
it with a real parser and evaluate it — do not use `eval` or `new Function`. This is a sandbox
boundary; a naive implementation is a security defect.

`runProbes(probes, session)` returns every result, never stops at the first failure, and marks
timeouts individually.

### 3.7 Query surface

Extend `telemetry.read` and add `trial.read` in the tool bus (`v04` §3.4 `tools/telemetry.ts`,
`tools/trial.ts`) so agents can query without importing code. Response shapes come from the
contracts written in `v02`; implement them exactly, including the `dropped` counter.

---

## 4. Files

**Create:** `packages/core/telemetry/**`, `packages/core/trials/**`,
`contracts/telemetry.channels.json`, `bench/cases/meta/telemetry/**`.

**Modify:** `contracts/telemetry.schema.json` (channel catalogue reference only),
`contracts/derivations.json`, `packages/toolbus/services.ts` (replace the stubs with real
implementations), `packages/toolbus/tools/telemetry.ts`, `packages/toolbus/tools/trial.ts`,
`docs/ARCHITECTURE.md`.

**Do not touch:** `src/**`, `vendor/**`, `backend/agent/**`. The existing instruments keep working
untouched; you are adding a parallel queryable layer.

---

## 5. APPROVED DEPS

None.

---

## 6. Acceptance criteria

- **A1** `bench/cases/meta/telemetry/synthetic/` — a fake solver emits a known signal (sum of two
  sines plus noise at a known seed). Every metric in `metrics.ts` is asserted against a
  closed-form or hand-computed expected value within 1e-6 relative.
- **A2** Insufficiency: a series with 2 samples fed to `stddev` returns `null` +
  `insufficient:true`. A `goal` that evaluates to `null` yields `verdict:"error"` with
  `INSUFFICIENT_DATA`, never `pass` or `fail`.
- **A3** Quality enforcement: a sample with `quality:"derived"` and no `derivations.json` entry is
  rejected by the recorder; `quality:"unavailable"` with a non-null `value` is rejected.
- **A4** Determinism: the same graph + same seed run 10 times produces 10 byte-identical NDJSON
  recordings (compare hashes).
- **A5** Bounded memory: a run producing 10× `max_telemetry_samples` returns a query result whose
  `dropped` is non-zero and whose `sample_count + dropped == attempted`.
- **A6** Recording integrity: truncate a recording mid-file and assert `readRecording` reports
  `truncated:true`, and that any trial referencing it resolves to `verdict:"error"`.
- **A7** Sweep: a 3×2 parameter space × 2 repeats = 12 runs, deterministic ordering, one
  intentional solver failure on run 7 → summary shows `errors:1`, `runs:12`, and the other 11 are
  unaffected.
- **A8** Cancellation mid-sweep → `verdict:"error", code:"CANCELLED"`, partial results returned,
  never `pass`.
- **A9** Probe language: a corpus of 40 expressions (valid and hostile) parses or is rejected
  correctly. Hostile cases must include prototype pollution (`constructor.prototype.x`), `__proto__`
  assignment, `this`, `globalThis`, deep property access (`a.b.c.d`), and an infinite loop attempt.
  **Zero** reach `eval`.
- **A10** Token scrub: no telemetry sample, metric or trial record contains a runtime token.

---

## 7. Verification

```powershell
npm run core:test
npm run build
npm run lint
npm run contracts:check
node bench/run.ts
node scripts/python.mjs -m pytest backend/tests -q
npm test -- --workers=1
```

---

## 8. Out of scope

- Any real solver. `v06`, `v07`, `v11`, `v12`. You build the machinery and test it with fakes.
- Wiring the existing browser instruments to publish to the bus. `v13`.
- Charts or UI. `v10`, `v13`.
- Any ML, fitting or optimisation beyond `linearFit*`. Optimisation is `v09`.

---

## 9. If you are blocked

If a metric's hand-computed expected value disagrees with your implementation, **do not relax the
tolerance**. Derive the correct value on paper, put both in the bench case, and record the
discrepancy in `DEVIATIONS`. A wrong metric that passes its own test is the worst outcome in this
phase.

If `max_telemetry_samples` in the stub `capability.json` is smaller than a realistic run needs,
raise the limit in the generated file (it is generated, so change the generator input, not the
output) and note it.

---

## 10. Final report

`docs/phase-reports/v05_telemetry_trials.md`: `BASELINE`, `CHANNEL_CATALOGUE` (count by source and
quality, and the list of channels that exist in the UI but are `unavailable`), `METRICS` (each with
its expected value), `ACCEPTANCE` table, `EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.