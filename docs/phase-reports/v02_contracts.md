# Phase v02 — Contracts

- **Date:** 2026-10-14
- **Branch:** `v2`
- **Classification: AMBER**

## BASELINE

Phase v01 closed with four dependency-free checks passing. No `node_modules`, no `.venv`, so
`npm run build`, `oxlint`, `pytest` and Playwright could not run — unchanged from v01.

The source of truth this phase reads:

| Source | Content |
|---|---|
| `backend/agent/schemas.py` | `_TOOL_FIELDS`, `_DESCRIPTIONS` — the single tool definition |
| `backend/hardware/boards.py` | `BOARDS` — 6 boards with runtime metadata |
| `backend/catalog/component-pins.json` | 157 components, 1,907 pins, 156/157 verified |
| `tests/*.spec.ts` | ~130 executable specs — the evidence for what actually simulates |
| `docs/COMPONENT_SIMULATION_AVAILABILITY.md` | a **stale** inventory; see DRIFT |

## DRIFT

**The availability document contradicts the test suite, and the test suite is right.**

`docs/COMPONENT_SIMULATION_AVAILABILITY.md` lists **70 of the 73** parts with modelled behaviour
as unsupported. Meanwhile `tests/led-runtime.spec.ts`, `tests/dht-runtime.spec.ts`,
`tests/bmp-runtime.spec.ts`, `tests/i2c-sensors.spec.ts`, `tests/spice.spec.ts` and ~20 more exist
and exercise exactly those parts. The document's own header says its tables are "the historical
unsupported inventory" and that the Uno exceptions "do not apply to that combination" — but its
tables still list them.

Two options were available:

1. Trust the prose table. Result: **6 parts simulated out of 157.** Provably wrong.
2. Trust executable evidence. Result: **81 simulated**, each citing the spec that proves it.

Option 2 was taken. Every `simulated: true` kind now carries an `evidence: [tests/…]` array, the
generator **fails** if a cited spec does not exist, and `check-contracts.mjs` fails if any kind
claims simulation without evidence. Phase v06 upgrades this from "a spec exists" to "the spec
passes" once CI can run.

This drift is recorded because it is the single most important fact the contracts layer surfaced:
**your platform can build 152 parts and can evidence 81 of them.**

## CHANGES

**Created — `contracts/` (generated, 48 files in the manifest)**

| File | Contents |
|---|---|
| `graph.schema.json` | Node/Edge/Port/ArtifactRef/Firmware. JSON Schema 2020-12 |
| `telemetry.schema.json` | Sample with the four quality values and an `unavailable → value:null` rule |
| `trial.schema.json` | Goal, sweep space, seed, per-run verdict, summary |
| `capability.schema.json` | What the platform may claim |
| `capability.json` | **Stub**, honestly marked `generator_status: "stub"` |
| `derivations.json` | How each derived channel is computed |
| `port-types.json` | 19 port types with closed `compatible_with` sets |
| `kinds.json` | 158 kinds (152 parts + 6 boards), 81 simulated with evidence |
| `manifest.json` | sha256 per file |
| `tools/*.tool.json` | 40 tool contracts |

**Created — tooling**

- `scripts/gen-contracts.py` (103 lines) + `scripts/contracts/{common,kinds,schemas,tools}.py`
- `scripts/check-contracts.mjs` — dependency-free contract verifier
- `bench/cases/meta/contracts/` — 6 assertions wired to real checkers

**Modified** — `package.json` (`contracts:gen`, `contracts:check`, and `check-contracts` added to
`lint`), `bench/run.mjs` (assertions may declare a `checker` command).

## ACCEPTANCE

| id | criterion | result |
|---|---|---|
| A1 | `gen-contracts.py --check` reports current; regeneration is byte-identical | **PASS** — verified by hashing twice |
| A2 | No kind claims `simulated:true` without evidence that exists on disk | **PASS** |
| A3 | `capability.json` declares limitations with `required_to_support` | **PASS** — 7 entries |
| A4 | Every backend tool has a contract | **PASS** — 19/19 legacy + 21 new |
| A5 | Every mutating tool declares `REVISION_STALE` | **PASS** |
| A6 | Telemetry quality rule is expressible | **PASS** |
| A7 | Port types are closed; no kind uses an undeclared type | **PASS** |

```
check-contracts: PASS  (158 kinds, 81 simulated with evidence, 40 tools, 7 declared limitations)
check-file-size: PASS  (280 files scanned, 2 oversized and baselined)
bench:            PASS  (6 assertions: 6 passed, 0 failed, 0 skipped)
contracts --check: current (158 kinds, 40 tools)
```

### The checks have teeth

Deliberately corrupted `kinds.json` by stripping `evidence` from a simulated kind:

```
check-contracts: FAIL — 2 problem(s)
  kinds.json: sha256 mismatch — manifest says c7b2b876f412, file is b185c31dce92
  kind board.arduino-mega claims simulated:true but cites no evidence
exit=1 (expect 1)

--- restored ---
check-contracts: PASS
exit=0 (expect 0)
```

Both the manifest hash check and the evidence check fired. The assertion is not vacuous.

## EXISTING_TESTS

| suite | result |
|---|---|
| `pytest backend/tests` | **NOT RUN** — no venv |
| Playwright | **NOT RUN** — no `node_modules` |
| `npm run build`, `oxlint` | **NOT RUN** |
| `check-contracts` | PASS |
| `check-file-size` | PASS |
| `check-docs` | PASS |
| `verify-backend-structure` | PASS |
| `bench` | PASS — 6/6 |

No application code was touched in this phase, so the existing suites should be unaffected — but
that is not measurement and is not claimed as such.

## GAPS

1. **`simulated` means "a spec exists", not "the spec passes".** The distinction only becomes
   enforceable once Playwright can run. Phase v06 closes it by reading `bench/results/`.
2. **`packages/core/contracts/` loader was not built.** The brief specifies a TypeScript loader
   with `ajv`. `ajv` is not installed and cannot be added. Everything in this phase is therefore
   verified by `check-contracts.mjs` (plain Node) rather than by the loader the brief asked for.
   This is the largest single deviation.
3. **`contracts/capability.json` is a stub.** No solver has registered, so `confidence` is
   `unknown` everywhere. Correct, and honest — but it means `capability.read` cannot yet answer
   a real question.
4. **Nested pydantic models are not fully described.** `('from': (_Endpoint, ...), ...)` emits
   `{"type": "object"}` with a pointer to the defining model. Field-level constraints are not
   duplicated. Acceptable until the loader lands.
5. **`docs/COMPONENT_SIMULATION_AVAILABILITY.md` is still stale.** It is the source a human reads
   first and it contradicts the test suite. It should be rewritten from the generated
   `kinds.json` in a later phase.

## DEVIATIONS

1. **The generator is Python, not TypeScript, and reads source via AST rather than importing.**
   The brief specified a TypeScript loader using `ajv`. Importing `backend/agent/schemas.py`
   requires pydantic, which is not installed. A small AST evaluator reads the module instead and
   **raises loudly** on any construct it does not understand, so a future edit cannot silently
   produce a wrong contract. Four `Unsupported` failures were hit and fixed during development —
   `**` spread in a dict, a missing name, a `dict()` copy, and pydantic class references.

2. **`contracts/tools/` declares 21 tools that do not exist yet** (`node.add`, `trial.sweep`,
   `bom.build`, …). They are marked `"implemented_in_phase": "v04"`. An agent reading the contracts
   sees the whole intended surface; nothing here pretends they work.

3. **`capability.json` is a stub, deliberately.** Declaring `simulated:true` before a solver has
   registered would be exactly the overclaiming this project exists to prevent.

4. **`scripts/gen-contracts.py` had to be split** once: the god-file guard flagged it at 1,128
   lines. That is the guard working, not a problem.

5. **`kinds.json` group assignment is rule-based**, and `derived_by` records which rule fired.
   4 parts initially fell through to `part.unresolved_*`; group rules were extended until none did.
   No kind is invented, and no unresolved entry is left.

## Status

v02 is complete and verified **within the dependency-free envelope**. The contract layer exists,
is deterministic, is internally consistent, and — the part that matters — cannot claim a
capability that no test file backs.

The loader (gap 2) and the pass/fail upgrade to `simulated` (gap 1) both require dependencies.
Both are recorded rather than faked.