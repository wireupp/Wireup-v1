# v01 — REPO GROUND RULES

**Goal:** make this repository safe and effective for autonomous agents to work in, and for
humans to verify. No product features in this phase.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0 applies in full. Implement exactly this brief. Do not add features.
Do not ask whether something should be improved.

---

## 1. Context

The repo works but is hostile to AI editing:

- God files: `src/components/ui/ai-prompt-input.tsx` (82 KB), `src/components/hardware-workspace.tsx`
  (69 KB), `backend/agent.py` (1067 lines), `backend/hardware.py` (1228 lines).
- ~13 contradictory status documents (`docs/RELEASE_*`, `LANGCHAIN_AUDIT.md`, `RELEASE_STATUS.md`).
- No CI (`.github/` contains one stale modernize note).
- No `AGENTS.md`.

Agents reading this today will cite random stale docs and make conflicting edits. Fix the ground
before building anything on it.

---

## 2. Preconditions — verify, do not assume

Confirm these before starting; record findings in your report.

1. `git status --short` is clean or your changes are understood.
2. `npm run build` currently succeeds. Record the exact result. **If it already fails, stop and
   report — do not fix it, it is not this phase's job.**
3. `npm run lint` currently succeeds or fails only with warnings. Record which.
4. `node scripts/python.mjs -m pytest backend/tests -q` — record pass/fail counts. Pre-existing
   failures are allowed; **new** failures are not.
5. Locate every doc listed in §5 and confirm it exists before deleting.

---

## 3. What to build

### 3.1 `AGENTS.md` at repo root

The operating contract for any agent or human working here. Must contain, in this order:

- **What this product is** — one paragraph. Simulation platform: circuits, firmware, mechanics,
  software; driven by AI over MCP; results handed to humans as build lists.
- **Read-first rule** — `contracts/` before source. If a contract exists, it is truth.
- **Architecture map** — a directory tree of `packages/`, `services/`, `apps/`, `bench/`, and a
  one-line purpose for each. Anything not yet created by a later phase is listed as
  `(planned, phase vNN)` so the map is stable from day one.
- **Non-negotiable invariants** — copy `prompts/v00_MASTER_PLAN.md` §3 verbatim as a list.
- **Change protocol** — one concern per change; run the full verification set before reporting;
  never disable a test to make it pass; never delete a failing test without a replacement assertion.
- **God-file rule** — no new file above 800 lines. Editing a file above 800 lines is allowed only
  if the change does not grow it; extract instead.
- **Dependency rule** — no runtime dependency without it appearing in the phase brief's
  `APPROVED DEPS`.
- **Verification commands** — the exact commands, copy-pasteable, PowerShell.
- **Phase protocol** — how to pick up `prompts/vNN_*.md`, where to write the report.
- **Never do** — the ten prohibitions from `v00` §0, restated tersely.

Keep it under 250 lines. It is a constitution, not a manual.

### 3.2 CI workflow `.github/workflows/ci.yml`

A single `verify` job on push and pull request, running, in order:

1. `npm ci`
2. `npm run build`
3. `npm run lint`
4. `npm run test:api` (Python via `scripts/python.mjs`; mark `continue-on-error: false` but allow
   the documented pre-existing failure list — implement this as an explicit allowlist file
   `bench/known-failures.txt`, one `test_file.py::test_name` per line, empty is fine)
5. `npm test -- --workers=1`
6. `node bench/run.ts` — must exit 0 and print a per-case table. If `bench/` does not exist yet,
   create a minimal `bench/run.ts` that discovers `bench/cases/**/case.json`, runs zero cases, and
   exits 0. This gives later phases a CI slot for free.

No secrets in CI. No provider keys. Tests that require live model providers stay skipped in CI —
they must be marked, not silently green.

### 3.3 Documentation hygiene

- Create `docs/ARCHITECTURE.md`: the living description of the system — the graph idea, the layer
  diagram, the data flow from agent to solver to telemetry, and a "current state" section that
  links phase reports. Under 300 lines.
- Create `docs/adr/README.md` and `docs/adr/0001-record-architecture-decisions.md` (the ADR
  template: Context / Decision / Consequences / Status). Write `0002-contracts-before-code.md`:
  schemas in `contracts/` are the source of truth for shapes; code conforms; schemas are versioned.
- Create `docs/phase-reports/README.md` describing the report format used by every phase.
- **Delete** these, after copying any surviving unique fact into `docs/ARCHITECTURE.md`:
  `docs/RELEASE_READINESS_REPORT.md`, `docs/RELEASE_REGRESSION_AUDIT.md`,
  `docs/RELEASE_20_PROJECT_REPORT.md`, `docs/RELEASE_20_PROJECT_REPORT-rerun.md`,
  `docs/RELEASE_20_PROJECT_REPORT-targeted.md`, `LANGCHAIN_AUDIT.md`.
- **Rewrite** `RELEASE_STATUS.md` at repo root to a 30-line pointer: what is verified locally, what
  is not, and that the authoritative record is `docs/ARCHITECTURE.md` + `docs/phase-reports/`.
  Preserve every *factual* claim about unverified capability (ESP32-C3 runtime failure, Pico W
  radio, remote simulation not deployed, compiler not sandboxed, AGPL obligations) as a short
  list of open risks. Do not lose honesty while removing noise.
- Keep `README.md`, `backend/HARDWARE_CONTRACT.md`, `backend/FEASIBILITY_CONTRACT.md`,
  `backend/QUESTION_CONTRACT.md`, `docs/SIMULATION_INTEGRATION_BACKLOG.md`,
  `docs/VELXIO_EXAMPLE_FINDINGS.md`, `docs/COMPONENT_SIMULATION_AVAILABILITY.md`. Add a one-line
  header to each pointing at `docs/ARCHITECTURE.md` as the parent document.

Before deleting a report, `git grep` it for inbound references and fix or remove those references.

### 3.4 God-file guard

- Add `scripts/check-file-size.mjs`: walks `src`, `packages`, `services`, `apps`, `backend`;
  fails if any tracked source file exceeds 800 lines; supports `--baseline <file>` to whitelist
  files that already exceed it (seed the baseline with the current offenders, and print the list so
  it is visible).
- Seed `bench/known-oversize.txt` with today's offenders and their line counts.
- Wire the check into `npm run lint` as a second step (do not replace oxlint).
- Add `scripts/check-docs.mjs`: fails if `docs/` contains a file matching the deleted-report names,
  and fails if any markdown file in `docs/` is older than its phase report claims to supersede it.
  Keep this deliberately simple — it exists to stop the sprawl from returning.

### 3.5 God-file extraction — minimal, behaviour-preserving

Only these three extractions, only mechanical, only to get under the limit or close to it:

- `backend/agent.py` → `backend/agent/__init__.py`, `backend/agent/schemas.py`
  (`_TOOL_FIELDS`, `_SCHEMAS`, `_DESCRIPTIONS`, pydantic arg models), `backend/agent/limits.py`
  (`MAX_*`, system prompt), `backend/agent/graph.py` (`stream_agent` body). `backend/agent.py` is
  **deleted**; `from backend.agent import stream_agent` must keep working unchanged.
  Move the tool-name tuples (`TOOL_NAMES`, `HARDWARE_TOOL_NAMES`, `_ASSESSMENT_TOOLS`,
  `_FIRMWARE_TOOLS`, `_READ_FIRST`, `_MUTATIONS`, `_CONFIRM_FIRST`) to `schemas.py` and re-export
  them from `backend/agent/__init__.py` so existing imports do not break.
- `backend/hardware.py` → `backend/hardware/__init__.py`, `boards.py` (`BOARDS`, `BOARD_CONFIG`,
  `PIN_LAYOUTS`, board pin maps), `projects.py` (`HardwareService` class), `commands.py`
  (the `command()` dispatcher), `api.py` (the `APIRouter` and its routes). Same import guarantee:
  `from backend.hardware import router as hardware_router, local_connection` must keep working.
- `src/components/ui/ai-prompt-input.tsx` → `src/components/chat/` split into
  `composer.tsx`, `model-picker-mount.tsx`, `prompt-history.ts`, `attachments.ts`, and an
  `index.ts` that default-exports the same component. No visual or behavioural change. Verify by
  running the existing Playwright specs that touch the composer
  (`tests/chat-composer*`, `tests/composer-outline.spec.ts`, `tests/chat.spec.ts`).

`src/components/hardware-workspace.tsx` is **explicitly out of scope for this phase** — its
extraction is entangled with the tool bus and belongs to `v13_UI_UNIFICATION`. Leave it alone
beyond keeping it working.

---

## 4. Files

**Create:** `AGENTS.md`, `.github/workflows/ci.yml`, `bench/run.ts`, `bench/known-failures.txt`,
`bench/known-oversize.txt`, `docs/ARCHITECTURE.md`, `docs/adr/README.md`,
`docs/adr/0001-record-architecture-decisions.md`, `docs/adr/0002-contracts-before-code.md`,
`docs/phase-reports/README.md`, `scripts/check-file-size.mjs`, `scripts/check-docs.mjs`,
`backend/agent/*`, `backend/hardware/*`, `src/components/chat/*`.

**Delete:** the six reports named in §3.3, `backend/agent.py`, `backend/hardware.py`.

**Modify:** `package.json` (lint script), `README.md`, `RELEASE_STATUS.md`, the five kept docs
(one-line header each), `backend/app.py` only if an import path must be adjusted.

**Do not touch:** `src/hardware/**`, `src/components/hardware-workspace.tsx`, `src/components/breadboard-view.tsx`,
`src/components/schematic-*.tsx`, anything under `vendor/**`, `public/**`.

---

## 5. APPROVED DEPS

None. This phase adds zero dependencies.

---

## 6. Acceptance criteria

Map each to `bench/cases/meta/repo-hygiene/assertions.json` (create it):

- **A1** `AGENTS.md` exists, is ≤250 lines, and contains all nine required sections.
- **A2** `.github/workflows/ci.yml` runs build, lint, api tests, playwright, bench.
- **A3** `node bench/run.ts` exits 0 and prints a table.
- **A4** None of the six deleted reports exist; no inbound references to them remain
  (`node scripts/check-docs.mjs` passes).
- **A5** `RELEASE_STATUS.md` is ≤30 lines and still names all five open risks.
- **A6** `npm run build` passes.
- **A7** `npm run lint` passes and now includes the file-size and docs checks.
- **A8** No tracked source file outside `bench/known-oversize.txt` exceeds 800 lines.
- **A9** `from backend.agent import stream_agent` and
  `from backend.hardware import router, local_connection` still resolve; `backend/tests` shows no
  new failures vs. the baseline you recorded in §2.
- **A10** All Playwright specs that passed before still pass (compare counts).

---

## 7. Verification — run these and paste real output

```powershell
node scripts/python.mjs -m pytest backend/tests -q
npm run build
npm run lint
npm test -- --workers=1
node bench/run.ts
node scripts/check-file-size.mjs
node scripts/check-docs.mjs
```

---

## 8. Out of scope — do not touch

- Any simulation, solver, MCP, graph or 3D work. Later phases.
- `vendor/**`. Not even to remove the committed `.vsix` binaries — note it under `GAPS`.
- The AGPL licensing decision. Note it under `GAPS`; it is a RED escalation for a human.
- Changing any user-visible behaviour of the app.

---

## 9. If you are blocked

Stop and report. Do not work around a blocker by skipping a check, disabling a test, or relaxing a
threshold. The one acceptable workaround is recording a pre-existing failure in
`bench/known-failures.txt` — and only if you verified it failed **before** your changes.

---

## 10. Final report

Write `docs/phase-reports/v01_repo_ground_rules.md` containing, in this order and nothing else:

1. `BASELINE` — the §2 verification results, before any change.
2. `CHANGES` — files created / deleted / modified, one line each.
3. `ACCEPTANCE` — a table: assertion id, command, real result, PASS/FAIL.
4. `EXISTING_TESTS` — before/after counts for pytest and Playwright.
5. `ESCALATION` — GREEN / AMBER / RED with a one-paragraph justification.
6. `GAPS` — things this brief did not cover that you noticed. **Do not act on them.**
7. `DEVIATIONS` — anything you did differently and why. Empty is a good answer.