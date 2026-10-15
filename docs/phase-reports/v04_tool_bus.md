# Phase v04 — Tool bus

## BASELINE

- Branch: `v2`.
- Existing legacy mutation dispatch is `HardwareService.command` in `backend/hardware/projects.py`.
- The graph core and electronics adapter are present under `packages/core/graph/`.
- Per user instruction, no tests, builds, benchmarks, or backend commands were run for this continuation.
- v04 legacy response baselines were not captured before coding: **NOT RUN**.

## LEGACY_BEHAVIOURS

| Behaviour in the legacy service | Status |
|---|---|
| Project and firmware revision checks | Preserved in `HardwareService.command` and mutation handlers; bus integration/parity **NOT RUN** |
| 200 KB command-argument limit | Preserved in `HardwareService.command`; bus integration/parity **NOT RUN** |
| Reject non-finite JSON via `allow_nan=False` | Preserved in `HardwareService.command`; bus integration/parity **NOT RUN** |
| `429` when too many browser runtime commands are pending | Preserved in `backend/hardware/runtime_bridge.py`; bus integration/parity **NOT RUN** |
| `503` when the compiler remains busy | Preserved in `HardwareService.command`; bus integration/parity **NOT RUN** |
| Retain only the last 10 artifacts | Preserved in `HardwareService.command`; bus integration/parity **NOT RUN** |
| Detect stale compilation and runtime artifacts | Preserved in `HardwareService.command`; bus integration/parity **NOT RUN** |
| `authorize_runtime` token check for runtime commands | Preserved in `HardwareService.command`; bus integration/parity **NOT RUN** |

## CHANGES

- `packages/toolbus/errors.mjs` — structured errors and recursive secret scrubber; strips stack-bearing fields and Node stack frames from mapped errors.
- `packages/toolbus/schema.mjs` — contract argument/result shape validation.
- `packages/toolbus/services.mjs` — injectable service defaults that fail with owning-phase `NOT_IMPLEMENTED`.
- `packages/toolbus/registry.mjs` — contract/handler registry with parity checks and an explicit handler-table input for parity validation; the default contract-derived handler table remains unchanged.
- `packages/toolbus/tools/index.mjs` — graph, legacy, and phase-owned unavailable handler routing.
- `packages/toolbus/bus.mjs` — structured invocation, review checks, project serialization, events, deadlines, rate limit, batch calls; invocation exceptions are converted to secret-scrubbed `ToolResult` failures, mutating revision and authoritative review checks occur after acquiring the project lock, legacy target kinds are checked against review scope, handler-emitted events pass through the secret scrubber, and event-sink failures are returned as warnings rather than misreporting a successful mutation as failed.
- Review authorization now applies approved quantity limits to every review-gated operation that resolves one or more node kinds, rather than only `add_component`; it rejects non-positive or unsafe quantities before invoking the handler.
- `packages/toolbus/index.mjs` — public module exports.
- `bench/cases/meta/tool-bus/` — acceptance checks for token/stack scrubbing in results, errors, and failed event sinks; missing handlers; unavailable service phases; review validation; stale revisions; concurrent mutations; and invalid-argument error codes. A3–A9 now execute and pass. No legacy response baselines were fabricated.

## ACCEPTANCE

| Assertion | Result |
|---|---|
| A1 — legacy parity against saved response baselines | **NOT RUN**; required baselines were not captured |
| A2 — existing pytest and Playwright counts unchanged | **NOT RUN** |
| A3 — runtime-token and stack scrubbing in result, error and events | `node bench/cases/meta/tool-bus/check.mjs A3` | **PASS** |
| A4 — registry rejects missing/extra handlers | `node bench/cases/meta/tool-bus/check.mjs A4` | **PASS** |
| A5 — explicit phase-owned failures for unimplemented services | `node bench/cases/meta/tool-bus/check.mjs A5` | **PASS** |
| A6 — reviewed scope validation for gated tools | `node bench/cases/meta/tool-bus/check.mjs A6`; verifies missing review, unauthorized review, wrong kind, excess quantity and approved success | **PASS** |
| A7 — stale revision and atomic rejection across mutators | `node bench/cases/meta/tool-bus/check.mjs A7`; current case checks one stale mutator without graph change, not every mutator | **PARTIAL** |
| A8 — concurrent mutation behaviour | `node bench/cases/meta/tool-bus/check.mjs A8`; one succeeds and 19 return explicit stale results | **PASS** |
| A9 — no uncaught tool errors for invalid arguments | `node bench/cases/meta/tool-bus/check.mjs A9`; iterates registered tools with null arguments | **PASS** |

## EXISTING_TESTS

- `node bench/cases/meta/tool-bus/check.mjs`: **PASS**, A3–A9.
- `node --check packages/toolbus/bus.mjs`: **PASS**.
- `npm run core:test`: **NOT RUN**.
- `npm run build`: **NOT RUN**.
- `npm run lint`: **NOT RUN**.
- `node scripts/python.mjs -m pytest backend/tests -q`: **NOT RUN**.
- `npm test -- --workers=1`: **NOT RUN**.
- `node bench/run.mjs`: **NOT RUN**.

## ESCALATION

**RED** — the focused A3–A9 ToolBus acceptance checks now pass, including the corrected general review quantity gate. The required legacy parity evidence is still absent and the backend/API and LangGraph adapters are not wired to this bus. Do not route production mutations through this implementation until parity and production integration are resolved and verified.

## GAPS

- The contract set contains tools from later phases; unavailable handlers are registered but core handlers for all v04 groups are not complete.
- Backend command-route and in-app agent integration remain on their pre-existing paths.
- The brief names `backend/hardware/commands.py`, but this checkout's dispatcher is `HardwareService.command` in `backend/hardware/projects.py`; no production rewire was attempted without the required parity baselines.
- `ToolContext` construction, persistent graph storage, tool result shape parity, and legacy error/status mapping need implementation.
- The schema validator currently covers common object/array/string/number/boolean/enum/const constraints; full JSON Schema compliance is not established.
- The required baseline fixtures and v04 parity assertions are absent.
- Full parity, build, lint, backend, Playwright, and bench suites remain unrun; only the focused meta/tool-bus acceptance check and targeted lint were run in this continuation.

## DEVIATIONS

- Used executable `.mjs` modules rather than `.ts`, matching the repository's existing dependency-free, directly runnable graph-core modules and its Node 22 runtime.
- Kept review authorization fail-closed behind an injected validator rather than treating a caller-supplied scope as proof of approval.
