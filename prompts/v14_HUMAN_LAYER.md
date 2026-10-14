# v14 — HUMAN LAYER: REVIEW, BUILD LIST, PLAY

**Goal:** close the loop with a person. An agent builds and verifies something; the human reviews
it in minutes, not hours. Then the human can grab it, change it, and keep going.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0, and the escalation model from §6. Two rules that matter most here:

1. **The review queue is the human's only required attention.** If a change lands in the queue it
   needs a page of context, not a diff.
2. **Never fabricate a price, a part availability, a lead time, or a safety claim.** An unpriced
   item is reported as unpriced. A part is "assumed available" unless a source says otherwise.

---

## 1. Context

`v09` produces a `BuildReport`. `v13` puts telemetry, trials and capability badges in the UI. What
is missing is the human surface: what needs my attention, what do I actually buy, and can I take
over and play.

Existing assets to reuse rather than replace: `src/components/build-guide.tsx` +
`backend/build_guide.py` / `build_guide_content.py` (the assembly prose contract),
`src/components/project-details.tsx` (the info/parts/wiring/instructions panel),
`src/components/feasibility-card.tsx` and `backend/feasibility.py` (the approval flow),
`src/components/instructions-guide.tsx` (the guided build steps).

---

## 2. Preconditions — verify, do not assume

1. `v09`'s orchestrator produces real `BuildReport`s. Save three real ones as fixtures:
   one `verified`, one `partially_verified`, one `infeasible`.
2. `v13` complete: every mutation is on the bus, and the bench UI is split.
3. `contracts/kinds.json` — check whether entries carry a `price` or `procurement` object. Record
   what exists. If nothing exists, say so; §3.2 handles it.
4. Read `backend/feasibility.py`'s approval-scope model and `src/components/feasibility-card.tsx`.
   The review queue must reuse that model, not invent a parallel one.
5. Record current Playwright counts (baseline).

---

## 3. What to build

### 3.1 The review queue — `src/components/review/`

The human's inbox. Three tiers, straight from `v00` §6.

**Data model** (`contracts/review.schema.json`):

```ts
{ id, project_id, graph_revision, tier: "green"|"amber"|"red",
  reason_code, reason, one_page: { what_changed[], what_proves_it[], what_it_costs_at_runtime[],
                                 screenshots[], risks[] },
  contract_changes: { contract, field, before, after, breaking }[],
  new_kinds: string[], new_tools: string[], new_deps: string[],
  verification: VerificationRow[],       // from BuildReport
  agent_run: { trial_ids[], iterations, budget_used, wall_ms },
  status: "open"|"approved"|"changes_requested"|"rejected",
  resolution?: { by, at, note } }
```

**Queue ranking:** RED first, then AMBER by (risk weight × unverifiability), then GREEN collapsed
to a count. A human should be able to process the whole red queue in one sitting.

**The one page.** Exactly one screen. It answers, without scrolling past a fold: what is it, what
proves it, what could go wrong, what did it cost, and what are the two buttons. It embeds the
screenshots from the run. It shows the verification table with `quality` badges — and any row
marked `NOT PHYSICALLY VERIFIED` is visually unmistakable.

**Actions:** `Approve`, `Request changes` (free text, goes back to the agent as an instruction),
`Reject`, `Approve and open in bench`. **No free-form "merge" — this is a build, not a pull
request.** Git is not involved.

**Batch actions:** approve all GREEN in the queue with one click, showing the count first.

### 3.2 The build list — `src/components/build/`

This is the artefact a human takes to their bench.

- **Parts table:** line id, kind, label, quantity, price, availability, substitute, why it is
  there (the `purpose` from the plan). Grouped by `group` from `contracts/kinds.json`.
- **Pricing:** a `PricingSource` interface with a `none` implementation that returns
  `{price: null, reason}`. An optional `vendored` CSV adapter behind an explicit setting, with
  provenance and licence recorded. **The default is `none`.** The total line reads
  *"N of M items unpriced — total unavailable"* when any item lacks a price. Never a partial total
  presented as a total.
- **Wiring table:** from → port → to → port → edge kind, using human labels and pin names, exactly
  matching `BuildReport.wiring`.
- **Assembly steps:** reuse `backend/build_guide.py`'s output. Each step carries
  `power_state_required`. Steps that involve mains voltage or lithium batteries get an explicit
  warning surfaced in the UI — never hidden.
- **Firmware:** file, target, upload steps, and the **exact artifact hash** the simulation ran.
- **Honesty footer:** a permanent, non-dismissible block stating what was verified in simulation
  and what was not, generated from `BuildReport.verification` and
  `capability.json`. This is the platform's core promise, made visible.

### 3.3 Play mode — `src/components/play/`

*"or human can play around."*

- **Take over:** the human's edits go through the tool bus like any other client, so an agent and a
  human can interleave on one project without conflict (revision checks enforce ordering; show a
  clear "the agent changed this" marker).
- **Manual override:** sliders and toggles for the tunable parameters the trial identified
  (thruster PWM, sensor offset, timing). Each writes a real node property through the bus — no
  local-only override state.
- **Live run:** run the graph headlessly (`v07`) or in the browser, with telemetry live.
- **Try-it prompts:** "what happens if I…?" buttons that create a **trial**, not a guess. Answers
  come from measurement.
- **Sandbox mode:** arbitrary quick experiments with no project saved.

### 3.4 Change requests back to the agent

`Request changes` produces a `ChangeRequest`:

```ts
{ review_id, instruction, current_build_report, requested_revision }
```

This becomes an orchestrator input (`v09` §3.1 `ParsedGoal.raw` seeded with the instruction plus the
existing state), so the agent continues from the human's feedback rather than restarting. The
result re-enters the queue as a new item linked to the original.

### 3.5 Audit and export

- **Audit trail:** every build report, review decision, agent run and manual override, with
  timestamps and actor, in an append-only per-project log, exportable as NDJSON. No tokens, no keys
  (I8).
- **Project export:** a portable bundle — graph JSON, firmware sources, build list, assembly steps,
  capability snapshot, and the trial recordings referenced — as a `.zip` via `jszip` (already a
  dependency). Source may contain user secrets; the export UI must say so, matching the existing
  warning in `docs/BLUEPRINT_WORKFLOW_COMPARISON.md`.
- **Import:** restores a bundle into a new project. It is a *snapshot restore*, not a validated
  re-derivation — say so in the UI.

---

## 4. Files

**Create:** `contracts/review.schema.json`, `src/components/review/**`, `src/components/build/**`,
`src/components/play/**`, `src/lib/pricing.ts`, `bench/cases/meta/review/**`.

**Modify:** `src/App.tsx` (routes `/review`, `/review/:id`), `src/components/platform-home.tsx`
(queue badge), `services/orchestrator/report.ts` (add `review` linkage and `one_page` inputs —
additive only), `docs/ARCHITECTURE.md`, `docs/AGENT_GUIDE.md`.

**Reuse, do not modify:** `src/components/build-guide.tsx`, `src/components/project-details.tsx`,
`src/components/feasibility-card.tsx`, `src/components/instructions-guide.tsx`,
`backend/build_guide.py`.

**Do not touch:** `packages/solvers/**`, `services/mcp/**`, `src/hardware/**`, `vendor/**`,
`backend/agent.py`.

---

## 5. APPROVED DEPS

None. `jszip`, `recharts` and `zustand` are already present.

---

## 6. Acceptance criteria

- **A1** Tier assignment is derived from the change, not self-declared: a change touching auth,
  contracts (breaking), dependencies, or with a failing assertion lands in RED **by test**.
  Write a test that constructs each case and asserts the tier.
- **A2** The one-page review fits one screen at 1440×900 for a full boat build with screenshots.
  Assert by measuring the rendered height of the page region.
- **A3** Every `verification` row in the review shows its `quality` badge, and `assumed` rows are
  rendered as `NOT PHYSICALLY VERIFIED`.
- **A4** Pricing: with the default `none` source, the total reads *"N of M items unpriced"* and
  asserts no numeric total is displayed. With a fixture CSV source, totals compute and the source
  and as-of date are shown.
- **A5** Every assembly step that touches mains or a lithium pack carries a visible warning. Assert
  by inspecting the rendered step list for a boat-with-battery build.
- **A6** Play mode: a manual PWM change writes a real node property through the bus (assert via the
  network interception from `v13` A1) and the next run reflects it.
- **A7** Change request: a review requesting changes produces a new orchestrator run seeded from
  the existing state, and the new report re-enters the queue linked to the original.
- **A8** Audit export contains no token, key, or credential — assert with the same scrubber from
  `v04`.
- **A9** Export → import round trip preserves the graph, firmware, BOM and assembly steps; the
  restored project re-runs a trial and produces the same verdict.
- **A10** The existing chat, feasibility and build-guide specs still pass with identical counts.
- **A11** A human can complete a full review of a `verified` boat build — add a Playwright test
  that performs exactly that flow end to end, and assert it needs **no** devtools, no console, and
  no reading of logs.

---

## 7. Verification

```powershell
npm run build
npm run lint
npm test -- --workers=1
node bench/run.ts
npm run mcp:smoke
node scripts/python.mjs -m pytest backend/tests -q
```

Plus: paste the rendered one-page review for the boat build (as text/structure, not a screenshot
file), and the pricing assertion output from A4.

---

## 8. Out of scope

- Payments, purchasing, cart, or supplier integration.
- Accounts, teams, sharing, or collaboration.
- Any backend capability change.
- Multi-currency beyond carrying a declared currency per price source.
- Mobile layouts.

---

## 9. If you are blocked

If live pricing is wanted, it is still off by default and stays off. `PricingSource` with a `none`
implementation that renders honestly is a **complete** implementation of this phase's pricing
requirement. Do not add a supplier integration to avoid an awkward empty state.

If the one-page review cannot fit, the problem is usually that the agent's `reason` is too long.
Constrain the report to a length in `services/orchestrator/report.ts` and record the change. Do not
make the page scroll.

If A11 is hard to satisfy, it usually means a user-facing surface is missing an error state. Add the
state. This test is the difference between a demo and a product.

---

## 10. Final report

`docs/phase-reports/v14_human_layer.md`: `BASELINE`, `REVIEW_MODEL` (the tiers and how each is
derived), `PRICING` (the honest-empty-state behaviour and the assertion), `PLAY_MODE`,
`ACCEPTANCE` table, `EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.