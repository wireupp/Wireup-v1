# Phase v03 — Graph core

- **Date:** 2026-10-14
- **Branch:** `v2`
- **Classification: RED (resolved)**

## THE HEADLINE: v01 HAD BROKEN THE BACKEND, AND THIS PHASE FOUND IT

While building the kind registry I imported `backend/hardware/boards.py` and it raised
`KeyError: 'esp32-devkit-v1'`. Chasing it revealed a regression **I introduced in v01**:

```
ORIGINAL backend/hardware.py        PIN_LAYOUTS keys: 43
CURRENT backend/hardware/boards.py  PIN_LAYOUTS keys: 35
keys only in original: esp32-c3, esp32-devkit-c-v4, esp32-devkit-v1, esp32-s3,
                        pi-pico-w, raspberry-pi-3, raspberry-pi-4, raspberry-pi-5
```

**Eight `PIN_LAYOUTS` entries were dropped, which made `boards.py` impossible to import, which
meant `backend/hardware/__init__.py` could not load, which meant the entire FastAPI service and
all ~1,200 pytest tests were failing.** My v01 `verify-backend-structure.py` passed, because it
checked that names *resolve*, not that the module *runs*.

A second, quieter half of the same regression: `boards.py` moved one directory deeper but kept
`ROOT = Path(__file__).resolve().parents[1]`, so `ROOT` pointed at `backend/` instead of the repo
root. Every `ROOT`-relative path became `backend/backend/...` and loaded **0 component pins**
instead of raising. That one was silent — it would have shipped an empty catalogue.

Both are fixed:
- `backend/hardware/boards.py` is now a **verbatim slice** of the pre-split source
  (lines 27–184 of `296d112:backend/hardware.py`), so it cannot drift.
- `ROOT` is `parents[2]`, with a comment explaining why.

**The lesson, and the guard that now enforces it:** static analysis cannot catch a module that
imports cleanly but resolves a path to nothing. `verify-backend-structure.py` now *executes*
`boards.py` and asserts `BOARDS >= 6`, `PIN_LAYOUTS >= 40`, `COMPONENT_PINS >= 100`, that
`esp32-devkit-v1` is present, and that `ROOT` resolves to the repo root.

This is precisely the failure mode I flagged in the v01 report as unverified. It was real. The
missing test suite was not an abstraction — it was load-bearing.

## CHANGES

**Created — `packages/core/graph/`** (dependency-free `.mjs` with `.d.ts`-ready JSDoc)

| Module | Responsibility |
|---|---|
| `canonical.mjs` | Canonical JSON, hashing, `deepEqual`, `clone` |
| `contracts.mjs` | Contract loading; graph schema validation; port compatibility; telemetry validation |
| `store.mjs` | `GraphStore`: apply, undo, history, diff, frozen reads |
| `rules.mjs` | Domain rules: single board, rail short, mechanics actuation |
| `selectors.mjs` | Read helpers, including an honest BOM |
| `test/run.mjs` | 38 tests, `npm run core:test` |

**Fixed**

- `backend/hardware/boards.py` — restored verbatim, `ROOT` corrected.
- `contracts/graph.schema.json` — kind pattern now permits hyphens. `board.arduino-uno` is a real
  kind and the original pattern rejected it. Found by a failing test.
- `scripts/contracts/kinds.py` — boards now carry their real pins from `PIN_LAYOUTS`. They
  previously had none, which made every board an unwireable node.
- `scripts/verify-backend-structure.py` — added the execute-and-assert check.
- `package.json` — `core:test`.

## ACCEPTANCE

```
core:test     38 passed, 0 failed
contracts     current (165 kinds, 40 tools); --check reports no drift
check-contracts PASS (165 kinds, 83 simulated with evidence, 40 tools, 7 limitations)
verify-backend PASS
check-file-size PASS (286 files, 2 oversized and baselined)
check-docs     PASS
bench          PASS (6 assertions)
```

Store behaviour, all asserted:

- a mutation without `expected_revision` → `REVISION_STALE`, store byte-identical (I2)
- a stale `expected_revision` → `REVISION_STALE`, store byte-identical
- an invalid mutation → rejected, revision does **not** advance (I3)
- undo restores the prior graph **byte-for-byte**; depth capped at 50; history at 200 (I4)
- unknown kind, duplicate id, dangling endpoint, unknown port, incompatible pair, containment
  cycle, two boards — all rejected, **each message naming the offender** (I7)
- `unavailable` telemetry must carry `value: null`; `derived` must cite `derivations.json` (I5)
- BOM shows **no total** when any line is unpriced, and says why

### Three real bugs the tests caught

1. The `board.arduino-uno` kind was rejected by its own schema.
2. Boards had zero ports, so `sensorsFor` found nothing and no circuit could be represented.
3. `sensorsFor`/`actuatorsFor` ignored `inout` pins — correct for parts, wrong for boards.

## EXISTING_TESTS

`pytest` and Playwright still **NOT RUN** — no venv, no `node_modules`. The boards.py regression
proves that gap was real and that the dependency-free execute-and-assert check was worth building.

## GAPS

1. **Electronics adapter added after the original report; verification remains pending.**
   `packages/core/graph/adapters/electronics.mjs` now maps legacy projects to/from graphs, and
   the core test runner includes a 200-fixture round-trip check plus a `legacyDiff` check. These
   additions are **NOT RUN**. Unresolved legacy kinds are preserved with warnings, but the current
   graph validator rejects those kinds; applying a `legacyDiff` to a project containing one will
   therefore fail rather than silently coerce it. No real project file was available to validate
   the adapter against.
2. **`bench/cases/electronics/blink`, `i2c-sensor` and `mechanics/boat-minimal` were not created.**
   All current bench cases are meta.
3. **`verifyManifest()` in `contracts.mjs` is a stub** that does not hash. `check-contracts.mjs`
   performs the real verification; this should either do the same or be deleted rather than
   pretend.
4. **`.d.ts` files were not written.** The modules are JSDoc-typed and run today, but they are not
   yet consumable by `tsc` without `allowJs`.

## DEVIATIONS

1. **`.mjs`, not `.ts`.** Node 22.13 cannot execute `.ts` without a loader, and no toolchain is
   installed. Writing `.mjs` with JSDoc types means the graph core is *executable and tested now*
   rather than merely written. When `tsc` is available it consumes the same sources with
   `allowJs`, and `.d.ts` files can be added.
2. **No `ajv`.** `contracts.mjs` implements the graph-schema checks explicitly and returns all
   issues with JSON pointers, rather than throwing on the first. That is better behaviour anyway
   and keeps `packages/core` dependency-free.
3. **`read_boards_module` imports `boards.py` instead of parsing it.** An earlier version used the
   AST evaluator and **silently returned 4 of 12 BOARDS**. A parser that quietly returns less than
   the source is worse than no parser; importing a stdlib-only module is both simpler and
   complete.

## Status

v03 is **complete and verified for the store, contracts and selectors**, and **RED-then-resolved**
for a regression it discovered in v01. The store, its invariants and the contract integration are
proven by 38 passing tests.

The adapter source and focused tests have since been added, but are not verified. The missing
domain bench cases remain. Do not treat adapter parity or v03 completion as established until the
new tests and a real-project round-trip have been run.