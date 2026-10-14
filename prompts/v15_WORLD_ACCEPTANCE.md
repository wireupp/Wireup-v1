# v15 — WORLD ACCEPTANCE

**Goal:** prove, with runnable evidence, that the vision is real. Not a demo, not a mock-up — a
test suite that fails if the product stops working.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0, and one that overrides everything else in this phase:

**This phase builds no new features.** Its only job is to execute the world version end to end and
prove it. Every test that already passes elsewhere is re-executed here in the one configuration a
real user or agent would use: **no chat UI, no browser session for simulation, only MCP.**

If a test here fails, the fix belongs in the phase that owns the failing capability. Fix it there,
record it in this report, and re-run. Do not weaken an assertion.

---

## 1. Context

Sixteen phases have produced: a repo that AI can work in, machine-checked contracts, a universal
graph, one mutation path, honest telemetry and trials, generated capability, a headless runtime,
an MCP server, a headless orchestrator, a 3D room, mechanics, software, a unified UI, and a human
review surface.

The claim to be tested:

> An external AI agent, connected only over MCP, can design, build, simulate, measure, iterate and
> hand a human a verified build list for a circuit, a boat, a drone and a website — with no browser
> and no human intervention until the report exists.

If that is true, the product does what the company set out to build. Everything else is detail.

---

## 2. Preconditions — verify, do not assume

1. Every prior phase report exists in `docs/phase-reports/` with its `ESCALATION` recorded.
2. `npm run contracts:check`, `npm run core:test`, `npm run mcp:smoke`, `npm run build`,
   `npm run lint`, `node bench/run.ts`, pytest and Playwright all pass.
3. A model provider is configured and reachable. **Record any live-provider failure and its cause
   before starting.** A provider outage is not a product failure; it must be reported as `SKIPPED`
   with the reason, never as `PASS`.
4. The reference MCP client from `v08` runs. The acceptance suite uses **only** that client — not
   the app, not internal imports, not a Python script reaching into the backend.
5. Record the wall-clock budget for the full acceptance run.

---

## 3. The acceptance suite — `bench/acceptance/`

Each scenario is a directory with `scenario.json` (the goal, the constraints, the required
outcomes), a `driver` script that plays the part of an external agent **using only MCP**, and
`assertions.json`.

The driver is a **scripted external agent**: it makes decisions by reading tool results and
capability declarations, exactly as a model would. It does not import platform internals. If it
needs something the tool surface does not expose, that is a **finding**, not a workaround.

### 3.1 `circuit-blink/` — the baseline

Goal: *"an Arduino Uno with an LED that blinks at exactly 1.00 Hz ±2%."*

Required: catalog lookup → project → parts → wiring → firmware → compile → headless run →
trial → measured frequency within 2% → BOM with ≥1 priced or explicitly unpriced line → wiring
table → assembly steps with a power warning → build report `status:"verified"` with a `measured`
frequency and a cited `trial_id`.

### 3.2 `line-follower/` — a real engineering loop

Goal: *"a line-following robot with three IR sensors that completes the test track under 12 s."*

Required: multi-node graph, a parameter sweep over sensor threshold and motor gain, at least one
iteration where a trial **fails** and the agent changes a parameter, a converging run, and a
report whose verification rows cite real trials. Assert the history contains at least one `fail`
verdict followed by a `pass` — a run that passes first try proves nothing.

### 3.3 `boat-fixed-speed/` — **the headline**

Goal: *"an ESP32-controlled boat that holds 1.2 m/s ±5% in still water for 20 simulated seconds,
within a $60 parts budget."*

Required:

1. `capability.read` consulted **before** planning; the response used.
2. Hull + 2 thrusters + ESP32 + battery assembled through `catalog.search` and `node.add`.
3. Firmware written and compiled.
4. Headless run — **no browser**, assert the browser lane was not used.
5. Firmware → PWM → thrust → hull acceleration coupling measured in one run.
6. A sweep over thruster PWM; at least one iteration fails and is corrected.
7. Steady-state speed over the final 30% of the run is within 5% of 1.2 m/s, `quality:"measured"`.
8. `bom.build` produces a build list. Either the total is ≤ $60 with a named price source, or it
   honestly reports items unpriced and the constraint is recorded as `unmet`. **A fabricated total
   fails this test.**
9. `assembly.read` returns steps, each with `power_state_required`, including the battery warning.
10. Report status `verified` for the speed goal.

### 3.4 `drone-weather/` — real data, real coupling

Goal: *"a quadrotor that holds 2 m altitude against the recorded weather dataset."*

Required: an `env.airspace` node bound to the **recorded** provider (not live), a barometer channel
driven by physics, firmware closing a loop on it, hover error < 3%, and every weather-derived
telemetry sample carrying its source and timestamp. Assert the report's `unmet` is empty and that
no sample is `assumed`.

### 3.5 `website-sensor/` — the laptop

Goal: *"a web page that shows the live temperature from my bench sensor and updates every second."*

Required: a `software.computer` in the graph, a `software.device_app` bridged to the bench MCU, a
generated app that runs in the sandbox, probes asserting the displayed value matches the sensor
telemetry within tolerance, `web.load_ms` `measured`, a screenshot artifact, a preview that is
byte-identical to the trial artifact, and a build report listing the app files plus the firmware.

### 3.6 `refusals/` — **the most important scenario**

The platform must still say no. Assert each:

- a goal needing CFD-grade hull analysis → refused with a specific `requiredToSupport`
- a goal needing real internet access from a sandbox → refused
- a goal needing a `placement_only` part's behaviour → planned with a disclosed risk, and
  **no verification row claims that behaviour**
- a budget of $0 → refused before any mutation
- a goal with no measurable metric → refused with `GOAL_NOT_MEASULARABLE`
- an ESP32-class target whose native runtime is documented as failing → the capability declaration
  says so and the run does not claim success

**If any of these now passes when it should refuse, the honesty machinery has regressed and this
phase is RED.**

### 3.7 `determinism/` — reproducibility

Each of 3.1–3.5 re-run three times from a clean state. Assert: identical firmware source, identical
telemetry hashes, identical BOM, identical verdicts. Only ids and timestamps may differ.

### 3.8 `human-loop/` — the human in the loop

A build report enters the review queue, a human-action script approves or requests changes via the
queue's tools, a change request re-enters the orchestrator, and the final report reflects the
correction. Assert the audit trail links the two runs and contains no secret.

### 3.9 `isolation/` — the security posture

Assert, as executable tests: the sandbox escape corpus fails; sandboxed processes cannot read
provider credentials; the runtime worker and sandbox cannot make unapproved network egress; MCP
stdio opens no socket; no audit record or telemetry contains a token.

---

## 4. What to build

- `bench/acceptance/**` — the scenarios, drivers and assertions above.
- `scripts/acceptance.mjs` — runs the suite from a clean state, prints a per-scenario table, exits
  non-zero on any failure.
- `npm run acceptance` — the entry point.
- `docs/ACCEPTANCE.md` — the **generated** results table, committed as evidence. It must state, for
  every scenario: what ran, what was measured, what was verified, what was **not** verified, and
  the wall-clock time. A table of green ticks without the "not verified" column is not acceptable
  output.
- `README.md` — a rewritten top section: what the product is, the three-object room, the four
  domains, the AI-over-MCP loop, and one honest paragraph on what is and is not physically
  verified. Under 120 lines.
- `docs/ARCHITECTURE.md` — a final pass so it describes what now exists, with every
  `(planned, phase vNN)` marker resolved.

## 5. Files

**Create:** `bench/acceptance/**`, `scripts/acceptance.mjs`, `docs/ACCEPTANCE.md`.

**Modify:** `package.json`, `README.md`, `docs/ARCHITECTURE.md`, `.github/workflows/ci.yml` (add an
`acceptance` job that runs on a schedule and on demand, **not** on every push — it is slow and
needs a provider key).

**Do not touch:** any source under `packages/`, `services/`, `src/`, `backend/`, `apps/`,
`contracts/`, `vendor/`. Fixes belong in their owning phase and are recorded here.

## 6. APPROVED DEPS

None.

---

## 7. Acceptance criteria

- **A1** `npm run acceptance` exits 0 with all scenarios passing, and prints a per-scenario table.
- **A2** Every scenario's assertions are in `bench/acceptance/**/assertions.json` and are executed —
  no assertion may be defined but skipped. A skipped assertion is a failure of this phase.
- **A3** `docs/ACCEPTANCE.md` includes a non-empty "not verified" column for every scenario.
- **A4** The boat's steady-state speed is genuinely within 5%, computed from a telemetry channel
  recorded in a headless run with no browser session. Assert the browser lane was never invoked.
- **A5** The line-follower scenario's history contains at least one `fail` verdict followed by a
  `pass`.
- **A6** All six `refusals/` cases refuse, with correct codes and specific `requiredToSupport`
  text.
- **A7** `determinism/` passes for all five build scenarios.
- **A8** `isolation/` passes — zero escapes, zero credential exposures.
- **A9** The acceptance drivers use only MCP. Assert by running them with the internal TypeScript
  modules made unresolvable (a build check: the driver bundle must not import `packages/*`
  internals).
- **A10** `contracts/capability.json` contains **zero** kinds marked `simulated:true` that are not
  exercised by a passing acceptance scenario or bench case. This is the final honesty audit.
- **A11** `README.md` and `docs/ARCHITECTURE.md` describe only what exists. A test greps them for
  `(planned, phase` markers and fails if any remain.
- **A12** All prior suites still pass with their recorded counts.

---

## 8. Verification

```powershell
npm run contracts:gen
npm run contracts:check
npm run core:test
npm run build
npm run lint
npm run mcp:smoke
npm run acceptance
npm test -- --workers=1
node scripts/python.mjs -m pytest backend/tests -q
```

---

## 9. If you are blocked

An acceptance failure is the most valuable thing this phase can produce. **Report it precisely**:
which scenario, which assertion, the real values, and which phase owns the capability.

- Fix the owning phase. Do not relax the assertion.
- If a scenario cannot run because of an external factor (provider outage, no network, missing
  credential), mark it `SKIPPED` with the exact cause and leave its assertions unexecuted — and
  record that `SKIPPED` prominently in `docs/ACCEPTANCE.md`. **Never convert a `SKIPPED` into a
  `PASS`.**
- If a scenario is impossible because the platform genuinely cannot do it, that is a product
  finding. Report it as `FAIL` with the missing capability, and note whether it should be built.
  Do not rewrite the scenario to something achievable.

If more than three scenarios fail for the same root cause, stop and escalate RED with a diagnosis.
That is a systemic failure and continuing will waste the run.

---

## 10. Final report

`docs/phase-reports/v15_world_acceptance.md`:

1. `RESULT` — one line: REACHED / NOT REACHED, with the count.
2. `SCENARIOS` — per scenario: goal, real outcome, measured values, verdict, wall time.
3. `NOT_VERIFIED` — everything the world version still cannot do, honestly and specifically.
4. `HONESTY_AUDIT` — the A10 capability cross-check, and the refusals with their exact texts.
5. `DETERMINISM` — the re-run table.
6. `SECURITY` — the isolation results.
7. `DEFECTS_FOUND` — every failure, its owning phase, and whether it was fixed here (it should
   not have been).
8. `ESCALATION` — GREEN / AMBER / RED.
9. `GAPS`, `DEVIATIONS`.

**Then stop. The world version is either reached or it is not, and the honest statement of which
one is the most valuable output of this entire programme.**