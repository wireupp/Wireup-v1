# v12 — SOFTWARE SOLVER

**Goal:** *"make me a website"* works. A `Computer` node in the room holds software children — a
web app, a script, a firmware target — and those children **run**, are **probed**, and their
behaviour is **measured**. The software solver is what makes the laptop a real object rather than
decoration.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0, **I5**, **I9**, and one non-negotiable addition:

**Executing agent-authored code is the highest-risk operation in this platform.** Every rule in
§3.2 is a security boundary. A finding under `SECURITY` in your report is an automatic **RED**
escalation, and shipping without it is a critical defect.

---

## 1. Context

Today the platform can compile and run microcontroller firmware (`v07`) and simulate physics
(`v11`). It cannot run application software. Yet the vision explicitly includes *"a user says:
make me a website"* — and the laptop is one of the three objects in the room.

`contracts/kinds.json` already has a `part.unresolved_*` escape hatch and `contracts/kinds.json`
has no `software.*` group. This phase adds it.

The reference for output quality: a generated website must actually run, must be probeable
(assertions about its DOM and state), and must be presentable to a human in the browser.

---

## 2. Preconditions — verify, do not assume

1. `v11` complete: the `mechanics` and `environment` solvers work, and `v09`'s honesty tests
   (both the now-positive and still-negative paths) pass. The software goal will use the same
   machinery.
2. `packages/solvers/protocol.ts` — the `software` solver is registered as an unavailable manifest.
3. `packages/core/trials` `runTrial` and the probe language from `v05` §3.6.
4. Read `docs/AGENT_GUIDE.md` — its structure is the model for how a new capability is documented
   to agents.
5. Record the current threat model posture from `v07`'s report — reuse its controls, do not invent
   a weaker parallel one.

---

## 3. What to build

### 3.1 `contracts/kinds.json` — the `software.*` group

- `software.computer` — a machine. Properties: `{ cpu_model?, memory_mb, cores, os,
  network: { allowlist[], deny_internet: true } }`. Children: `software.web_app`,
  `software.script`, `software.service`.
- `software.web_app` — `{ entry: "index.html", files: {"index.html": "...", "app.js": "..."},
  framework: "vanilla"|"react"|…, build: {…} }`. Edges: `net.http` to other nodes,
  `data.stream` to sensors, `signal.electrical` to a microcontroller it can drive.
- `software.script` — `{ language: "python"|"node", entry, files, requirements[], timeout_s }`.
- `software.service` — a long-running process with a declared interface (a queue, a socket, an RPC).
- `software.device_app` — the thing that actually talks to hardware: exposes GPIO-like ports via a
  declared transport (`serial`, `usb`, `wifi_local`, `i2c_over_bridge`). **This is how a website
  controls an ESP32.**

Ports: `net.http` (in/out), `data.stream` (in/out), `data.file`, `signal.electrical` (only via
`software.device_app`), `env.reference`.

### 3.2 `packages/solvers/software/` — execution and isolation

**This is a sandbox. Design it as an adversary would.**

**Web apps:**
- Run in a **separate process** (Node worker or a dedicated browser context in a Playwright-driven
  headless Chromium — decide, document the choice, and justify it in the report).
- A local static server bound to **loopback on an ephemeral port**, owned by the sandbox supervisor.
- Content Security Policy: no inline event handlers, no `eval`, no remote script sources, no
  network beyond the allowlist. Enforced by header, not by convention.
- **No network by default.** `deny_internet` defaults to `true`. Allowlisted origins are opt-in per
  node and per session, and every fetch is logged. A web app that tries to reach a non-allowlisted
  host fails visibly in the trial result with `SANDBOX_NETWORK_DENIED`.

**Scripts:**
- Python in a **separate process** with: a scrubbed environment (no provider credentials — I8), a
  restricted `cwd`, a wall-clock timeout, a memory cap, and an output cap.
- Dependency installation is **off by default**. A script may only import from a fixed stdlib set
  plus explicitly vendored, hash-pinned wheels in `packages/solvers/software/vendor/`. An agent
  cannot cause an arbitrary package install — that would be remote code execution with extra
  steps. Record dynamic dependency support under `GAPS`.

**The sandbox escape test is mandatory.** Write `bench/cases/software/escape/` containing, at
minimum: reading `process.env`, reading `~/.aws/credentials`, writing outside the scratch dir,
fork-bombing, opening a raw socket, `eval` in a web app, prototype pollution, and an infinite
loop. **All must fail cleanly, be recorded as a sandbox violation, and leave the supervisor alive.**
A single escape is a critical defect; do not report completion.

**Resource limits** come from `capability.json` `limits`: wall clock, memory, output bytes,
concurrent processes, file writes.

### 3.3 `probes.ts` — the software probe target

Extend the `v05` probe language with web/script targets:

- `{ target: { app, url_path } }` → query the live DOM: `text()`, `count()`, `attr("id")`,
  `exists()`, `css("color")`, `value()`, `html()` — implemented as **explicit named operations**,
  never as arbitrary property traversal in the probe expression.
- `{ target: { app, console } }` → captured console messages and page errors.
- `{ target: { app, network } }` → requests made and their status codes.
- `{ target: { script, symbol } }` → the value of a declared exported symbol.

Every probe result carries `quality`. "The DOM node exists" is `measured`. "The page renders
correctly" is a judgement and must be expressed as concrete probes — **never as a general
correctness score invented by the solver.**

### 3.4 `render.ts` — presenting the result

A web app the agent built must be viewable by a human. Produce, per app run:

- A **screenshot** artifact (`ArtifactRef` kind `screenshot`) at declared viewports, from the
  sandboxed renderer.
- An **HTML bundle** artifact containing the source, packaged for offline opening.
- A **preview URL** bound to the sandbox process while it runs.

In the room (`v10`'s focus view), clicking the laptop shows its apps with live previews. Clicking
the app opens it full-window. **The preview must be the same code the trial ran** — serving from
source files rather than the built artifact is a divergence bug; assert they are byte-identical.

### 3.5 `computer.ts` — device apps talking to hardware

`software.device_app` bridges to the tool bus:
- `serial` → an existing `runtime-worker` MCU session; the web app's `fetch("/pin/13", {method:"POST"})`
  maps to a pin write on that session.
- The bridge is **request/response over HTTP with an allowlisted origin and a session-scoped
  token** (I8 — the token never appears in page-visible state or logs).
- Assert the round trip in a bench case: a page sets a pin, firmware reads it, telemetry confirms.

### 3.6 Telemetry and trials

Channels (in `contracts/telemetry.channels.json`): `web.dom_ready`, `web.load_ms`,
`web.console_errors`, `web.network_errors`, `web.http_status`, `script.exit_code`,
`script.stdout_lines`, `script.runtime_s`, `device.pin_level`, `device.uart_rx`.

Goals parse naturally: *"the page shows the temperature within 2 s of load"* →
`web.load_ms ≤ 2000` with `quality:"measured"`.

### 3.7 Orchestrator integration

`ParsedGoal.domain` gains `software`. A goal like *"build a web app that shows live temperature
from the sensor on my bench and updates every second"* must:

1. Create a `software.computer`.
2. Find the temperature sensor node in the existing electronics project (or create one).
3. Attach a `software.device_app` via the `serial` bridge.
4. Generate the app.
5. Run it, probe `web.http_status`, `web.load_ms`, `device.pin_level`, and assert the value shown
   matches the sensor's telemetry within tolerance.
6. Produce a build report listing the app files, the firmware, and how to deploy it.

Extend `v09`'s honesty tests: keep a negative case (*"build a web app that calls an internal
corporate API at `10.0.0.5`"*) that is correctly **refused** with
`requiredToSupport: "sandbox network egress policy"`. **Honesty must survive new capability.**

### 3.8 Bench cases

- `bench/cases/software/hello-app/` — generate, run, probe DOM, screenshot, assert.
- `bench/cases/software/dom-assert/` — a deliberately wrong app (wrong text) fails the probe. Proves
  probes have teeth.
- `bench/cases/software/escape/` — the full escape corpus from §3.2.
- `bench/cases/software/script/` — a Python script with a declared exit code and stdout assertion.
- `bench/cases/software/device-bridge/` — the firmware round trip.
- `bench/cases/software/limit/` — an infinite loop hits the wall-clock cap and is reported as
  `SANDBOX_LIMIT_EXCEEDED`, not a hang.

---

## 4. Files

**Create:** `packages/solvers/software/**`, `services/sandbox/**` (the supervisor),
`bench/cases/software/**`, `bench/cases/orchestrator/webapp/**`, `docs/SANDBOX.md` (the security
model — this is a required deliverable, not optional).

**Modify:** `contracts/kinds.json` (`software.*` kinds), `contracts/port-types.json` (only if
needed), `contracts/telemetry.channels.json`, `packages/solvers/software/manifest.ts`,
`services/orchestrator/goal.ts`, `apps/room/src/stations.ts` (laptop focus view now opens real
apps), `docs/AGENT_GUIDE.md`, `docs/ARCHITECTURE.md`.

**Do not touch:** `src/hardware/**`, `backend/**`, `packages/solvers/circuit/**`,
`packages/solvers/mcu/**`, `src/components/hardware-workspace.tsx`, `vendor/**`.

---

## 5. APPROVED DEPS

- `playwright` (already a dev dependency) for the headless renderer, **or** Node's built-in
  worker plus a JSDOM-equivalent only if it is sufficient. Choose one, document why in the report.
  Do not add a second browser automation framework.

No package-install library. No native compilation of dependencies.

---

## 6. Acceptance criteria

- **A1** The escape corpus: every attempt fails cleanly, is recorded as a sandbox violation with a
  code, and the supervisor survives all of them. **Zero escapes.**
- **A2** A sandboxed process cannot read `GROQ_API_KEY`, `AWS_SECRET_ACCESS_KEY`,
  `AZURE_API_KEY`, or `~/.aws/credentials`, even when they exist in the parent environment.
- **A3** Network denial: an app fetching a non-allowlisted host fails with
  `SANDBOX_NETWORK_DENIED` and the attempt appears in the trial record.
- **A4** `dom-assert` fails when the app is wrong, and passes when it is right — probes have teeth.
- **A5** Determinism: the same app + probe set run 3 times yields identical screenshots (hash) and
  identical probe results.
- **A6** The preview served to a human is byte-identical to what the trial ran. Assert by hash.
- **A7** Device bridge round trip works, and the session token does not appear in page state,
  console output, or any artifact.
- **A8** Resource limits: infinite loop, 1 GB allocation attempt, and 10 MB output attempt each
  return the correct `SANDBOX_LIMIT_EXCEEDED` within the configured bound.
- **A9** The orchestrator completes the temperature-app goal end to end over MCP, headless, with a
  `measured` load time and a build report listing app files plus firmware.
- **A10** The negative network goal is still correctly refused, with `requiredToSupport`.
- **A11** `capability.json` gains `software.*` as simulated, with `unavailable` listing: no
  dependency installation, no internet by default, no native compilation, no persistent storage
  across runs beyond the recording.
- **A12** Existing suites unchanged.

---

## 7. Verification

```powershell
npm run build
npm run lint
npm run core:test
npm run contracts:gen
npm run contracts:check
npm run mcp:smoke
node bench/run.ts
```

Plus: paste the escape-corpus results and one completed `BuildReport` for the web app goal.

---

## 8. Out of scope

- Installing agent-specified npm or pip packages. This is the single most dangerous feature in the
  plan and is not in this phase.
- Persistent databases or long-lived services across trials.
- Server-side rendering frameworks requiring a build toolchain beyond what is vendored.
- Editing application code from inside the room.
- Any real internet egress.

---

## 9. If you are blocked

If the sandbox cannot be made genuinely secure with the approved deps, **ship less capability, not
less security.** A `software.script` sandbox that is sound, with `software.web_app` declared
`unavailable`, is an acceptable phase. A web sandbox with a working `eval` path is not.

If a bench escape succeeds, stop and escalate **RED** immediately. Do not attempt a fix-and-hide.
The correct behaviour is to report it plainly, fix it, and re-run the whole corpus.

If the screenshot/preview cannot be byte-identical to the trial artifact, do not paper over it.
Either make it identical or make the preview explicitly labelled as a separate rendering, with the
difference documented.

---

## 10. Final report

`docs/phase-reports/v12_software_solver.md`: `BASELINE`, `SANDBOX_MODEL` (threats, controls, and
**what is not covered** — mandatory), `ESCAPE_CORPUS` (every attempt and its result),
`CAPABILITY_DELTA`, `SAMPLE_REPORT`, `ACCEPTANCE` table, `EXISTING_TESTS`, `ESCALATION` (state
RED if any escape occurred), `GAPS`, `DEVIATIONS`.