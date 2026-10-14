# v07 — HEADLESS RUNTIME WORKER

**Goal:** make the single most important capability possible — an AI agent compiles, runs, probes
and measures firmware **with no browser and no chat UI**. Today `run_simulation` requires a
connected browser WebSocket with an acknowledged runtime token, which means an external agent
cannot test anything at all.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0, **I9 determinism**, **I8 token secrecy**. This phase adds
**code execution**. Treat every line as a security boundary. Any finding in
`docs/phase-reports/v07_runtime_worker.md` under `SECURITY` is an automatic RED escalation.

---

## 1. Context

Three partial, unverified attempts exist:

- `src/hardware/runtime.ts` — genuine AVR (avr8js) and RP2040 (rp2040js) emulation, **in the
  browser**, driven over a WebSocket by `backend/hardware.py`.
- `backend/native_esp32.py` — ESP32 QEMU path; per `RELEASE_STATUS.md` the genuine C3 browser
  adapter fails at PC 0x514c26 and remote ESP is packaged but undeployed and unverified.
- `deployment/remote-simulation/` — a FastAPI service wrapping ESP QEMU, no URL or token configured.

Do not add a fourth. **Consolidate into one worker interface with pluggable lanes**, and make the
browser just one client of it.

---

## 2. Preconditions — verify, do not assume

1. `packages/solvers/protocol.ts` and `registry.ts` exist; the `mcu` solver manifest is registered.
2. Read `src/hardware/runtime.ts` end to end. Record: the emulated CPU entry points, the pin-edge
   capture path, the serial/UART path, ADC sampling, the timing model (how virtual time advances),
   and how results are returned. **The headless lane must produce the same telemetry the browser
   lane produces, from the same emulator code.**
3. Read `backend/hardware.py`'s runtime session handling (`authorize_runtime`, the WebSocket
   route, the `429` pending-command limit) and record it.
4. Record the *current verified* behaviour: which (board, firmware) pairs are known to run today.
   `RELEASE_STATUS.md` says Uno/Nano/Mega/Pico, plus Pico W external GPIO/UART0/button. Anything
   else is `unavailable` and stays so.

---

## 3. What to build — `services/runtime-worker/`

### 3.1 `lane.ts` — the lane interface

```ts
export interface RuntimeLane {
  id: string;                    // "avr" | "rp2040" | "esp32-qemu"
  targets: string[];             // board ids
  supports: { firmware_compiled: boolean; pin_probe: boolean; memory_probe: boolean;
              time_control: boolean; step: boolean; breakpoint: boolean };
  start(input: LaneStart): Promise<LaneSession>;
}

export interface LaneSession {
  id: string;
  step(dtSeconds: number): Promise<StepResult>;      // { t, cycles, pins, … }
  readPins(spec: PinReadSpec): Promise<PinSample[]>;
  readMemory(region: MemorySpec): Promise<MemoryDump>;
  probe(probe: Probe): Promise<ProbeResult>;         // from v05
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
```

Rules: `time_control` false means the lane runs in real time and `step` is unavailable — declare
it, do not fake it. `supports` feeds the capability manifest, so a lie here becomes a lie in
`contracts/capability.json`.

### 3.2 `avrlane.ts` and `rp2040lane.ts`

Run **the same emulator code the browser uses** — `avr8js` / `rp2040js` — in a Node worker. This
is the crux: if headless and browser disagree, the platform has two truths. Therefore:

- Extract the emulator driver out of `src/hardware/runtime.ts` into
  `packages/solvers/mcu/emulator/` as a **runtime-agnostic** module (no DOM, no `window`, no
  React). `src/hardware/runtime.ts` becomes a thin wrapper. Behaviour must be identical; the
  existing AVR/RP2040 Playwright specs (`tests/avr-peripherals.spec.ts`,
  `tests/uno-peripherals.spec.ts`, `tests/pico-runtime.spec.ts`, `tests/rp2040js`-related specs)
  must pass with identical counts.
- The headless lane wraps that module with a deterministic virtual clock: `step(dt)` advances
  exactly `dt` of emulated time, bounded by `maxSubsteps`. Wall-clock time never affects results.

### 3.3 `esplane.ts`

Wrap `backend/native_esp32.py` / `deployment/remote-simulation/server.py` behind the lane
interface, speaking JSON-lines over stdio. Ship it **registered with `knownFailures`** mirroring
the current documented state (C3 failure at PC 0x514c26, remote endpoint unconfigured). It must
work as a declared-unavailable lane, not as a broken one. Do not attempt to fix ESP emulation in
this phase.

### 3.4 `supervisor.ts` — process isolation

The worker is a **separate OS process**, not a thread.

- One worker process per concurrent run, hard-capped by `capability.json` `limits`.
- Spawned with: a scrubbed environment (no provider keys, no `GROQ_API_KEY`/`AWS_*`/`AZURE_*`/
  `NVIDIA_*` — invariant I8), a minimal `PATH`, no network access except the runtime service, and
  `cwd` set to a scratch directory.
- Wall-clock timeout (default 30 s, from `capability.json` `limits.max_sim_seconds`), memory cap,
  and output size cap. A worker exceeding any cap is killed and reported as
  `RUNTIME_LIMIT_EXCEEDED`.
- Worker stdout is a protocol channel; anything else on stdout is captured as a diagnostic, never
  parsed as a result.
- A crash is a normal outcome: report `RUNTIME_CRASHED` with the captured diagnostic. Never let a
  worker crash take down the API.

### 3.5 `server.ts` — the worker's API

Line-delimited JSON over stdio:

```
→ {"id","op":"start","payload":{ graph, artifact, seed, lane }}
← {"id","ok":true,"payload":{ session }}
→ {"id","op":"step","payload":{ session, dt }}
← {"id","ok":true,"payload":{ step: { t, cycles, telemetry: [...] } }}
→ {"id","op":"probe","payload":{ session, probes: [...] }}
← {"id","ok":true,"payload":{ results: [...] }}
→ {"id","op":"stop","payload":{ session }}
← {"id","ok":true,"payload":{}}
```

Every `←` response is `{ id, ok, payload }` or `{ id, ok:false, error:{ code, message } }`. A
malformed request never crashes the worker — it returns an error.

### 3.6 Wiring it to the tool bus

- `packages/toolbus/services.ts` gets a real `runtime` implementation. `runtime.run` now has two
  modes, chosen by an explicit argument, never guessed:
  - `{ "driver": "headless" }` → this worker. **The default for agents and trials.**
  - `{ "driver": "browser" }` → the existing WebSocket path, unchanged, with its token
    acknowledgement.
- `runtime.run`, `runtime.stop`, `runtime.probe`, `runtime.results` gain a `driver` field in their
  contract args (update the contract in `contracts/tools/`; this is a contract change → AMBER).
- Results are normalised: whichever driver ran, `runtime.results` returns the same
  `{ telemetry, pin_history, serial, exit, wall_ms, driver }` shape, published to the `TelemetryBus`
  from `v05`.
- `run_simulation` from the legacy route keeps defaulting to `browser` so the existing UI is
  untouched. **Change that default only in `v13`.**

### 3.7 Determinism harness

A `runtime-worker` bench case that compiles one firmware, runs it headless at 20 simulated
seconds with a fixed seed, and asserts:

- byte-identical telemetry across 5 runs,
- correct virtual time (`t` advances by exactly the requested `dt`),
- `step` results identical whether run as 200 × 0.1 s or 20 × 1.0 s (step-size independence — a
  real property of a correct emulator, and a strong test of the time model),
- a probe on a known pin returns the known value from the same firmware that the browser spec
  asserts today.

---

## 4. Files

**Create:** `services/runtime-worker/**`, `packages/solvers/mcu/emulator/**`,
`bench/cases/mcu/headless-determinism/**`.

**Modify:** `src/hardware/runtime.ts` (extract the driver; **behaviour identical**),
`packages/solvers/mcu/manifest.ts` (fill in `supports` truthfully),
`packages/toolbus/services.ts`, `packages/toolbus/tools/runtime.ts`,
`contracts/tools/runtime.*.tool.json` (add `driver`),
`package.json`, `docs/ARCHITECTURE.md`.

**Do not touch:** `src/components/**`, `backend/agent/**`, `vendor/**`, `src/hardware/spice.ts`,
`src/hardware/velxioParts.ts`.

---

## 5. APPROVED DEPS

None. `avr8js` and `rp2040js` are already dependencies. The supervisor uses only Node built-ins
(`child_process`, `worker_threads` is **not** used for isolation).

---

## 6. Acceptance criteria

- **A1** Headless run of the Uno blink firmware produces the same pin history the existing
  `tests/uno-lifecycle.spec.ts` / `tests/uno-peripherals.spec.ts` observe in the browser. Compare
  the two recordings.
- **A2** Pico W external GPIO + UART0 firmware runs headless with matching results; firmware
  containing `WiFi`, `Bluetooth`, `cyw43` or `LED_BUILTIN` returns the **exact existing error
  message** from `backend/hardware.py` (string equality against the current text).
- **A3** Step-size independence: 200 × 0.1 s ≡ 20 × 1.0 s, byte-identical telemetry.
- **A4** Five runs, one seed → byte-identical NDJSON recordings.
- **A5** Timeout: a firmware that loops forever is killed at the limit and returns
  `RUNTIME_LIMIT_EXCEEDED`; the API survives and stays responsive.
- **A6** Crash isolation: a deliberately corrupted artifact produces `RUNTIME_CRASHED` with a
  diagnostic; a subsequent normal run succeeds. Prove the API is still serving.
- **A7** **Environment scrub:** a worker started while the parent has `GROQ_API_KEY`,
  `AWS_SECRET_ACCESS_KEY` and `AZURE_API_KEY` set reports none of them in `process.env`, in its
  diagnostic output, or in any returned error. Assert all three.
- **A8** **No network:** the worker's only permitted egress is the runtime service; assert the
  supervisor blocks an outbound attempt and reports it.
- **A9** Concurrency: 4 concurrent headless runs, capped by limits, all complete correctly with
  independent sessions; a 5th is queued or rejected with a documented code (assert one, not both).
- **A10** ESP32 lanes report `knownFailures` and do not claim success. A run attempt returns the
  documented failure, not a fabricated result.
- **A11** All existing Playwright and pytest counts unchanged.

---

## 7. Verification

```powershell
npm run build
npm run lint
npm test -- --workers=1
node scripts/python.mjs -m pytest backend/tests -q
node bench/run.ts
```

Plus: paste the headless-vs-browser recording comparison from A1.

---

## 8. Out of scope

- Fixing ESP32 emulation. Declare it; do not attempt it.
- WebSocket streaming of live telemetry to the UI. `v13`.
- Removing the browser lane. Both lanes exist; `v13` flips the default for the UI.
- Sandboxing with containers or seccomp. Process isolation plus resource caps is this phase's bar;
  record container isolation under `GAPS` as a RED item for before public deployment.
- Any other lane (RP2040 PIO, z80, 8080 — all of which exist in the vendored tree). Out of scope.

---

## 9. If you are blocked

If the emulator cannot be extracted from `src/hardware/runtime.ts` without behaviour change, **do
not rewrite it**. Instead, load the existing module in a Node context with a minimal DOM shim for
the specific globals it touches, and record the shim under `GAPS`. A shim is honest; a
reimplementation is not.

If a lane cannot be made deterministic, ship it with `supports.step:false` and
`confidence:"partial"` rather than shipping non-determinism. Determinism is invariant I9.

If the security items A7 or A8 cannot be fully satisfied with process-level controls, **stop and
escalate RED**. Do not ship a worker that can read provider credentials. That is non-negotiable.

---

## 10. Final report

`docs/phase-reports/v07_runtime_worker.md` with sections: `BASELINE`, `LANES` (per lane: targets,
`supports`, `knownFailures`, honestly), `HEADLESS_VS_BROWSER` (the A1 comparison table),
`SECURITY` (threat model, controls, what is **not** covered — this section is mandatory and may
force RED), `ACCEPTANCE` table, `EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.