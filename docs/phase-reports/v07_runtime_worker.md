# v07 — Headless runtime worker

## BASELINE

- Branch: `v2`.
- The MCU solver is a legacy browser capability adapter. Its manifest names Uno, Nano, Mega,
  Pico and Pico W targets, but does not expose the v07 `RuntimeLane.supports` interface.
- The current runtime implementation is `src/hardware/runtime.ts`. It loads RP2040 code through
  Vite's `import.meta.glob`, uses DOM elements for peripheral models, and waits for
  `requestAnimationFrame` during startup. Its emulator driver has not been extracted into a
  runtime-agnostic module.
- The browser attaches over an authenticated project WebSocket. `RuntimeBridge` has a 10-second
  default acknowledgement timeout and rejects the 33rd pending command with HTTP 429.
- The current `run_simulation` contract has only `artifact_id`; there are no `runtime.*` contracts
  or `services/runtime-worker/` implementation in the current tree.
- The existing documented board limits include unsupported Pico W CYW43/WiFi/Bluetooth/onboard
  LED behavior and an ESP32-C3 emulator failure. Pico W firmware using `WiFi`, `Bluetooth`,
  `cyw43` or `LED_BUILTIN` is rejected with:
  `Pico W browser simulation supports external GPIO and UART0 only. This firmware uses the unimplemented CYW43 radio or onboard LED; use external GPIO firmware or real hardware.`

## LANES

| Lane | Current state | Targets and known limits |
|---|---|---|
| AVR | Existing browser runtime only; no headless lane | Uno, Nano and Mega; no v07 `supports` declaration |
| RP2040 | Existing browser runtime only; no headless lane | Pico and Pico W; Pico W radio and onboard LED unavailable |
| ESP32 QEMU | No v07 lane | Existing documented ESP32-C3 failure remains unavailable; no success is claimed |

No new lane or capability declaration was added.

## HEADLESS_VS_BROWSER

| Acceptance evidence | Result |
|---|---|
| Uno blink pin-history comparison against browser recordings | NOT RUN — no headless worker exists |
| Pico W GPIO/UART comparison | NOT RUN — no headless worker exists |
| Step-size independence and repeated-run determinism | NOT RUN |

The browser implementation is not presently importable as a shared Node emulator without the
specified extraction or a DOM/Vite shim. No shim or alternate emulator was added because it would
not demonstrate parity with the existing browser lane.

## SECURITY

**Threat model:** compiled firmware and runtime artifacts must not gain access to provider
credentials, host filesystem data, or arbitrary network destinations; worker crashes and resource
exhaustion must not affect the API.

**Controls implemented in this phase:** none. No worker process is spawned, and no security
property is claimed.

**Blocking findings:** the required A7 environment-scrub and A8 egress restrictions have not been
implemented or proven. An environment allowlist can remove inherited secrets but does not by
itself prevent a child process from opening network sockets. Implementing only process spawning,
timeouts, or output limits would therefore leave the required network boundary unenforced.
Because the brief says to stop if A7 or A8 cannot be fully satisfied, no executable headless worker
was shipped.

**Not covered:** all v07 worker security controls, including enforced egress policy, resource
limits, crash isolation, and credential-leak assertions. The existing browser runtime remains the
only runtime path.

## ACCEPTANCE

| Criterion | Result | Evidence |
|---|---|---|
| A1 Uno headless/browser pin-history parity | NOT IMPLEMENTED | No headless lane |
| A2 Pico W GPIO/UART parity and exact unsupported-feature error | PARTIAL, browser only | Existing rejection text recorded in `BASELINE`; no headless lane |
| A3 Step-size independence | NOT IMPLEMENTED | No deterministic headless stepping |
| A4 Five-run determinism | NOT IMPLEMENTED | No headless recorder |
| A5 Timeout and `RUNTIME_LIMIT_EXCEEDED` | NOT IMPLEMENTED | No worker supervisor |
| A6 Crash isolation and API responsiveness | NOT IMPLEMENTED | No worker supervisor |
| A7 Environment scrub assertions | NOT IMPLEMENTED | No worker process or leak test |
| A8 Enforced network restriction and blocked-egress assertion | NOT IMPLEMENTED | No verified enforcement mechanism |
| A9 Four-run concurrency limit | NOT IMPLEMENTED | No worker supervisor |
| A10 ESP32 known-failure refusal | PARTIAL, declaration only | Existing limitation documented; no v07 lane |
| A11 Existing Playwright and pytest counts unchanged | NOT RUN | No tests run |

## EXISTING_TESTS

- Full build, lint, Playwright, pytest and bench suites: NOT RUN.
- No runtime behavior was changed, so this report makes no test-parity claim.

## ESCALATION

**RED — blocked.** The phase requires a secure code-execution boundary, but A7 and A8 are
unproven. Shipping a worker without enforced egress controls would violate the phase's explicit
stop condition and the product's credential-secrecy invariant.

## GAPS

- Select and implement a verifiable OS-level network restriction for worker processes before
  enabling untrusted firmware execution. A child-process environment scrub is not a substitute.
- Extract the existing emulator driver into a runtime-agnostic module without changing browser
  behavior, or use the prompt's narrowly scoped DOM shim and prove browser parity.
- Reconcile the phase brief's TypeScript service/tool paths with the repository's current ESM
  ToolBus and legacy browser runtime contracts before making contract changes.
- Implement and assert the remaining supervisor, determinism, crash-isolation and concurrency
  requirements.

## DEVIATIONS

No runtime, contract, capability, package, or architecture files were modified. The only change is
this phase report, as required to record the blocked outcome. Work stopped before adding executable
code because the v07 security stop condition is not met.
