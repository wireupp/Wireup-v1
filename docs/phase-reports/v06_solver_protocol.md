# v06 — Solver protocol and capability

## BASELINE

The capability document was a `stub` derived from `contracts/kinds.json`; the solver registry and
generator did not exist. The project already had a browser ngspice path for DC/transient analysis
and browser AVR/RP2040 emulation, but neither ran through a shared solver protocol. The existing
bench report had no generated timestamp and did not contain the solver test ids needed to earn
`verified` confidence.

## MANIFESTS

- **circuit:** Claims only the catalog kinds already scoped to the existing SPICE path. Declares
  `dc` and `tran`; AC sweep, noise analysis, and temperature sweeps remain unavailable. The
  current adapter is a compatibility/preflight declaration; it delegates execution only through
  an injected service and does not yet connect the browser ngspice implementation to ToolBus.
- **mcu:** Claims only the existing browser-supported MCU and peripheral scopes. Declares Uno,
  Nano, Mega, Pico and Pico W targets. Pico W remains external GPIO/UART0 only; its CYW43 radio,
  WiFi, Bluetooth and onboard LED are not emulated. The ESP32-C3 known failure is recorded as
  `Vendor RiscVCore adapter fails at PC 0x514c26 after 2,666,667 cycles.` This remains the legacy
  browser capability declaration, not a headless runtime.
- **mechanics:** Unavailable. Vehicle, motor, drivetrain and hull behavior must not be presented
  as simulated.
- **environment:** Unavailable. No environment solver or generated environment measurements
  exist.
- **software:** Unavailable. There is no sandboxed website runtime or verified device bridge.

Confidence is computed from self-test outcomes and passing test-report ids. The present report
does not establish recent full test coverage, so no kind is marked `verified`.

## CAPABILITY_SUMMARY

The generated file contains 165 catalog kinds: 83 simulated with partial confidence and 82
placement-only. It contains 267 declared limitations, including the component availability
inventory and release blockers.

| Group | Total | Simulated |
|---|---:|---:|
| board | 14 | 5 |
| electromech | 4 | 0 |
| input | 12 | 10 |
| logic | 53 | 4 |
| output | 23 | 12 |
| passive | 38 | 35 |
| sensor | 19 | 17 |
| source | 1 | 0 |
| storage | 1 | 0 |

## ACCEPTANCE

| Criterion | Result | Evidence |
|---|---|---|
| A1 Deterministic generated output | PASS | Two regenerations produced SHA-256 `E2F73438E816044B4E5C553903A019EC49EF6996679A51ACBD2E6A0E876A1675`. |
| A2 Documented limitations preserved | PASS, focused | The capability checker extracts every component ID from the availability tables and checks the listed release blockers against generated limitations. |
| A3 ESP32-C3 and ESP32 kinds honest | PASS | MCU manifest preserves the documented PC/cycle failure; all `board.esp32*` kinds are non-simulated. |
| A4 Unsupported domains block a project | PASS, helper-level | A mechanics-domain project resolves with `can_run:false` and a mechanics solver requirement. The project-bound MCP/API path is not end-to-end tested. |
| A5 Confidence cannot be self-declared | PASS | Manifest validation rejects author-supplied confidence; missing test evidence yields `partial`, not `verified`. |
| A6 Duplicate registrations rejected | PASS | Focused checker asserts duplicate solver IDs and duplicate kind ownership throw. |
| A7 AC sweep refusal is explicit | PASS, protocol-level | `prepare` throws `SolverUnavailable` whose message is exactly `ngspice AC sweep implementation`. Not wired through ToolBus. |
| A8 Abort/deadline enforcement | NOT IMPLEMENTED | No solver supervisor or timeout harness exists; delegated adapter work can still outlive a request. |
| A9 200-cycle resource-leak check | NOT IMPLEMENTED | No real solver resources are currently owned by the protocol adapters. |
| A10 Existing SPICE specs retain identical counts | NOT RUN | The SPICE extraction was deliberately not attempted; existing browser behavior was not changed. |

The unsupported-list extraction and protocol/registry assertions run in
`bench/cases/meta/capability/check.mjs`; MCP capability tools were also exercised over a local
stdio session.

## EXISTING_TESTS

- `node scripts/gen-capability.mjs` — PASS; generated 165 kinds and 267 limitations.
- Repeated `node scripts/gen-capability.mjs` — PASS; output hash remained identical.
- `node bench/cases/meta/capability/check.mjs` — PASS.
- `npm run contracts:check` — PASS; 165 kinds, 83 simulated with evidence, 41 tools, and 267
  declared limitations; generated capability current.
- MCP stdio check of `capability_read` and `capability_explain` — PASS.
- Targeted Oxlint — exit 0. It reported one existing unused `definition` parameter warning in
  `packages/toolbus/tools/index.mjs`; no new solver-file warnings.
- `git diff --check` — PASS (Git reported the repository's LF-to-CRLF working-copy notices).
- Full build, full bench, Playwright, and pytest suites — NOT RUN.

## ESCALATION

**AMBER.** Added the `capability.explain` MCP contract and changed contract generation to produce
the capability document. No dependency, authentication, sandbox, or licensing implementation was
added.

## GAPS

- The circuit adapter does not yet extract the ngspice WebAssembly execution from
  `src/hardware/spice.ts`; its solver `run` requires an injected implementation. Therefore this
  phase does not yet route circuit solving through the registry/ToolBus.
- MCU manifests describe the existing browser runtime only. Headless execution, deterministic
  stepping, the worker supervisor, environment scrubbing, network restrictions, crash isolation,
  and concurrency controls remain v07 work.
- `capability.read` resolves a bound project's nodes in MCP and ToolBus helper paths, but there is
  no new standalone `/api/capability` endpoint.
- `capability.explain` identifies the manifest, current limitations and test ids absent or failing
  in the bench report. The current bench report lacks complete CI timestamps and solver test
  records, so confidence remains partial.
- The capability report intentionally exposes that mechanics, environmental physics, exact motor
  geometry, vehicle telemetry, sandboxed websites and the website-to-device bridge are not yet
  simulated. This does not deliver the requested RC-car/laptop system.

## DEVIATIONS

The repository's solver, ToolBus and script layers are dependency-free ESM (`.mjs`), and the
TypeScript build includes only `src/`. The protocol and registry follow the established ESM
convention rather than introducing uncompiled `.ts` files. The existing SPICE module was not
extracted because its browser-only ngspice worker path cannot be made a Node adapter without a
larger, behavior-sensitive change. The generated capability deliberately does not mark any kind
`verified`.
