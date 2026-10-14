# v09 — HEADLESS ORCHESTRATOR

**Goal:** an agent that takes a goal in plain language — *"a boat that holds 1.2 m/s in water"* —
and autonomously plans, builds, tests, iterates and returns a verified build list, with **no chat
UI and no human in the loop** until it has something worth showing.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0, **I5**, **I6**, **I10**. Three additional rules specific to this
phase:

1. **The orchestrator may not invent capability.** It must consult `capability.read` before
   planning and must downgrade or refuse when the platform cannot do what the goal needs.
2. **Every claim it makes must cite a recording.** "It reached 1.18 m/s" is only allowed with a
   `trial_id` and a channel. Otherwise it says "not measured".
3. **It stops.** Bounded iterations, bounded tokens, bounded wall time. A run that hits its bound
   reports partial progress honestly — never a confident summary of work it did not finish.

---

## 1. Context

`backend/agent.py` is a competent but **chat-shaped** agent: request-scoped LangGraph, streaming
NDJSON to a browser, 10 mandatory multiple-choice questions, a feasibility gate, an approval
workflow, a "Build it yourself" prose section. It is good at helping a person at a keyboard. It
cannot be pointed at a goal and left alone for twenty minutes.

The orchestrator is a different animal: no questions, no narration, no streaming — an
**experiment loop**. The question cards become an assumption log. The approval gate becomes an
automatic feasibility gate. The prose section becomes a structured report.

Do not fork the existing agent. Reuse the parts that are genuinely reusable (the feasibility
assessment, the build-guide generator) and write a new loop.

---

## 2. Preconditions — verify, do not assume

1. `v08`'s A3 passes: the headless MCP loop works end to end.
2. `packages/core/trials` can run a sweep and produce a verdict (`v05`).
3. `contracts/capability.json` is generated and honest (`v06`).
4. Read `backend/agent.py`'s `stream_agent` and `backend/feasibility.py` fully. Record precisely:
   the feasibility gate's rules, the approval scope model, and the build-guide output contract
   (`backend/build_guide.py`, `backend/build_guide_content.py`).
5. Record which provider(s) are configured and reachable. Note any live-provider failure under
   `BASELINE` — do not assume a model call works.

---

## 3. What to build — `services/orchestrator/`

### 3.1 `goal.ts` — goal parsing

Turn a plain-language goal into a structured, checkable form before anything is built:

```ts
export interface ParsedGoal {
  raw: string;
  domain: "electronics" | "mechanics" | "software" | "hybrid";
  deliverables: string[];          // what must exist at the end
  metrics: GoalMetric[];           // measurable, each with a target + tolerance
  constraints: { budget?; parts?; banned_kinds?; must_use?; deadline_s? };
  environment?: { water?; weather?; ground? };
  ambiguities: { question: string; assumption: string; why: string; confidence: number }[];
}
```

`ambiguities` replaces the 10 mandatory questions. Each unresolved question becomes an **explicit
recorded assumption** with a confidence, surfaced in the final report. The agent does not block on
a human; it proceeds on stated assumptions and marks them.

A goal with no measurable metric is **rejected** with `GOAL_NOT_MEASURABLE` and a concrete
suggestion of what to measure instead. The orchestrator does not accept "make it fast".

### 3.2 `planner.ts` — plan before building

Produce a `Plan`:

```ts
{ domain, board?, required_kinds: [{ kind, quantity, purpose }],
  metrics, trial_design: { parameters, repeats, seed_policy },
  build_steps: [{ tool, args_summary, depends_on[] }],
  risks: [{ description, mitigation, blocking }],   // from capability.read
  infeasible?: { reason, required_to_support } }
```

Rules:
- Every `required_kind` must exist in `contracts/kinds.json` and be `simulated` in
  `capability.json`. A non-simulated kind is allowed only with an explicit
  `risks[].blocking` entry, which propagates to the report.
- The plan is **validated before execution** by replaying it against the graph rules. An invalid
  plan never starts.
- A plan the platform cannot execute sets `infeasible` and the run stops before mutating anything.
  This is the "says no" path, and it must be exercised by a bench case.

### 3.3 `executor.ts` — the loop

```
for iteration in 1..max_iterations:
  1. read project + capability + last trial
  2. decide: next experiment (one parameter change, or a structural fix)
  3. mutate the graph via the tool bus   (all mutations through ToolBus — invariant I1)
  4. write/edit firmware if the change needs it
  5. compile if firmware changed
  6. run headless via runtime-worker      (v07 — no browser)
  7. run the trial / sweep                 (v05)
  8. compute the verdict
  9. if verdict == pass: break
 10. if verdict == error: classify; repair only if the classification is unambiguous,
                           otherwise stop and report
```

Budgets (from `capability.json` `limits`, all configurable):
`max_iterations` 12, `max_tool_calls` 400, `max_model_calls` 60, `max_seconds` 1800,
`max_spend_usd` from the provider's own pricing table (default 0 → the run refuses to start
without an explicit budget). Every budget is enforced, and exhaustion is reported as exhaustion.

`classify` maps error codes to actions: `REVISION_STALE` → re-read and retry;
`COMPILE_ERROR` → read diagnostics, edit firmware; `TIMEOUT` → reduce sim time; `DIVERGED` → report
and stop. Anything unclassified stops the run. **No blind retries** — the existing agent's
"retries at most twice" discipline applies to the whole loop.

### 3.4 `verdict.ts`

Compares measured metrics to `ParsedGoal.metrics` using only the rules in `contracts/trial.schema.json`.
Produces:

```ts
{ goal_id, metric, target, tolerance, measured: number|null, quality, trial_id,
  channel, recording, pass: boolean, reason }
```

`measured:null` → `pass:false`, `reason:"NOT_MEASURED"`. Never interpolate, never average across
unrelated runs, never present an `assumed` sample as a measurement.

### 3.5 `report.ts` — the build list

The deliverable a human actually receives. Structured, not prose:

```ts
export interface BuildReport {
  goal: ParsedGoal;
  status: "verified" | "partially_verified" | "unverified" | "infeasible";
  project_id: string; graph_revision: number;
  bom: { line_id, kind, label, quantity, unit_price?, currency?, source, substitute_for?, in_stock_note? }[];
  bom_total?: { amount, currency, priced_items, unpriced_items, price_source, as_of };
  wiring: { from:{node,label,port}, to:{node,label,port}, kind, note? }[];
  assembly: { step, instruction, warnings[], power_state_required }[];
  firmware: { filename, language, source, upload_steps[], target_board? };
  verification: { claim, measured, unit, quality, trial_id, recording }[];
  assumptions: ParsedGoal["ambiguities"];
  unmet: { requirement, reason, required_to_support? }[];
  confidence: { score, basis }[];
}
```

Rules that make this trustworthy:
- Every row in `verification` has a `trial_id` and `quality`. A row with
  `quality:"assumed"` is labelled `"NOT PHYSICALLY VERIFIED"` in the rendered form.
- `bom_total` includes `unpriced_items` and `price_source`. **Never fabricate a price.** Unpriced
  items are listed explicitly; the report says "N of M items unpriced".
- `status:"verified"` requires every goal metric `pass:true` with `quality:"measured"`. Anything
  weaker downgrades the status.
- `assembly` steps carry `power_state_required`, defaulting to "disconnect power before wiring",
  matching the existing build-guide contract.
- Reuse `backend/build_guide.py` / `backend/build_guide_content.py` for the prose assembly
  rendering so the output stays consistent with the in-app guidance.

### 3.6 `runner.ts`

```ts
runOrchestrator(goal, { provider, model, budget, db? }) → AsyncIterable<OrchestratorEvent> | BuildReport
```

Events (also published to the audit log): `plan.created`, `plan.rejected`, `iteration.started`,
`mutation.applied`, `compile.result`, `run.result`, `trial.result`, `verdict`, `budget.exhausted`,
`blocked`, `report.ready`. **No model narration.** The activity feed in the UI can render these as
a checklist later (`v13`).

### 3.7 The honesty tests — the most important assertions in this phase

- **H1** Goal: *"build a solar-powered boat"* (mechanics solver unavailable). The orchestrator must
  plan, discover `SOLVER_UNAVAILABLE` for the hull, set `infeasible` with
  `requiredToSupport`, execute **zero** mutations, and return
  `status:"infeasible"` with `unmet` populated. It must not produce a fake BOM.
- **H2** Goal with an impossible target (*"reach 9 m/s"*) — the run reaches its iteration bound and
  reports `status:"unverified"` with `unmet:[{…}]` and the actual measured best. No spin.
- **H3** A firmware that fails to compile → the orchestrator reads real diagnostics, edits, retries
  **at most twice**, then reports `unverified` with the compile error. Test asserts the compile was
  attempted exactly 3 times total, not more.
- **H4** Provider failure mid-run → the run stops, `status:"unverified"`, and the report states
  the provider error. It does not continue with a half-built project presented as success.
- **H5** A goal requiring a `placement_only` part → the plan carries a non-blocking risk, the build
  proceeds, and `verification` contains no claim about that part's behaviour.
- **H6** Budget exhaustion mid-sweep → `budget.exhausted` event, partial results returned,
  `status:"partially_verified"`. Never `"verified"`.
- **H7** Kill the orchestrator process at iteration 5 of 12 → the project is left in a valid,
  revision-consistent state; a subsequent run can resume from it.

### 3.8 Bench cases

- `bench/cases/orchestrator/unolen/` — Uno + LED, goal "blink at exactly 1 Hz", verified.
- `bench/cases/orchestrator/line-follower/` — multi-sensor, goal "follow the line", verified, with a
  sweep over sensor offset.
- `bench/cases/orchestrator/infeasible-hull/` — H1.
- `bench/cases/orchestrator/budget-bound/` — H6.

---

## 4. Files

**Create:** `services/orchestrator/**`, `bench/cases/orchestrator/**`,
`docs/ORCHESTRATOR.md` (short: the loop, the budgets, the honesty rules, how to run it from the CLI).

**Modify:** `backend/build_guide.py` only if needed to accept a structured report (prefer adding a
renderer over changing the generator), `backend/app.py` (mount `POST /api/orchestrate` as a thin
adapter — required so the UI can trigger it later), `docs/AGENT_GUIDE.md` (add a section), `package.json`,
`docs/ARCHITECTURE.md`.

**Do not touch:** `backend/agent.py`'s streaming behaviour or its 20 tools, `src/**`, `vendor/**`,
`services/mcp/**`, `packages/**`.

---

## 5. APPROVED DEPS

- `@langchain/langgraph` (already used by the Python side; for the TS loop use the LangChain JS
  equivalent already present, or a plain deterministic loop). Prefer a **plain loop** — no new dep.
- `ai` / `@ai-sdk/*` only if the existing model integration cannot serve a headless call. Record the
  choice in `DEVIATIONS`.

---

## 6. Acceptance criteria

All H1–H7 above, plus:

- **A1** `bench/cases/orchestrator/unolen` reaches `status:"verified"` with a `1 Hz` measurement from
  a real telemetry channel, `quality:"measured"`, and a cited `trial_id`. Assert the measured
  frequency is within 2% of 1 Hz.
- **A2** Three identical orchestrator runs on `unolen` produce identical firmware source, identical
  BOM and identical telemetry hashes.
- **A3** `unmet` is non-empty whenever `status != "verified"`.
- **A4** `verification` rows all carry `trial_id` and `quality`; zero rows lack either.
- **A5** No BOM line has a fabricated price. Cross-check: any `unit_price` must be traceable to the
  `price_source` named in `bom_total`, and unpriced items appear in `unpriced_items`.
- **A6** Budget enforcement: a run with `max_model_calls: 3` stops with `budget.exhausted` and
  cannot exceed 3 model calls. Assert from a counter.
- **A7** Iteration bound: a run that never converges stops at `max_iterations` and reports
  `unverified`.
- **A8** The orchestrator performs **zero** HTTP calls to the chat endpoint and requires **zero**
  browser WebSockets. Assert by running with the browser lane disabled and no chat client present.

---

## 7. Verification

```powershell
npm run build
npm run lint
npm run core:test
npm run mcp:smoke
node bench/run.ts
node scripts/python.mjs -m pytest backend/tests -q
npm test -- --workers=1
```

Plus: paste one complete `BuildReport` for `unolen` and one for `infeasible-hull`.

---

## 8. Out of scope

- Multi-agent, sub-agents, or parallel orchestrators.
- Autonomous model selection or provider routing.
- Any UI for the orchestrator. `v13`.
- Making `mechanics` or `software` work. Those are `v11` and `v12`; until then those goals are
  correctly `infeasible`, and H1 asserts that.
- Long-horizon memory across projects, or learning from past runs.

---

## 9. If you are blocked

If the loop cannot converge reliably on `unolen`, the problem is almost always the trial design,
not the planner. Fix the goal/metric/trial formulation first; do not add retries.

If model quality on the configured provider is insufficient for reliable planning, **narrow the
scope of what is model-driven**: make the plan schema-driven and deterministic (kind selection,
step ordering, parameter choice) and use the model only for firmware authoring and for explaining
failures. A deterministic loop with a model in the firmware seat is far more reliable than a
model planning everything. Record the choice in `DEVIATIONS` — it is the right call, not a
shortcut.

If H1 cannot be satisfied because some part of the platform claims mechanics support, that is a
**capability bug**: fix `v06`'s manifest, do not work around it in the orchestrator.

---

## 10. Final report

`docs/phase-reports/v09_orchestrator.md`: `BASELINE`, `LOOP` (a diagram of the iteration and where
each budget is checked), `HONESTY_TESTS` (H1–H7 with real outputs), `SAMPLE_REPORTS` (the two
pasted reports), `ACCEPTANCE` table, `EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.