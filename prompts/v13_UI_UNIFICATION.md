# v13 — UI UNIFICATION

**Goal:** every mutation in the product — from the canvas, from the chat agent, from the room, from
an external MCP client — goes through the same tool bus. Then split the remaining god files so the
codebase stays maintainable, and give the interface the surfaces the vision requires: live
mechanics, software workspaces, telemetry everywhere.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0 and **I1 single mutation path**. The test for this phase is a
single assertion: **if a user can change a project without going through the tool bus, this phase
has failed.** No exceptions carved out for the canvas, for drag-and-drop, or for "just this one
feature".

---

## 1. Context

The frontend currently calls `POST /api/hardware/project/{id}/command` directly from several
components, maintains its own optimistic state, and has its own simulation session over a
WebSocket. `v04` built the bus and proved parity; the bus is not yet the UI's path.

After this phase:
- `src/components/hardware-workspace.tsx` (69 KB) is gone, replaced by a composition of focused
  panels.
- The app's state lives in one store derived from the graph, updated by bus events.
- Live telemetry, trials and mechanics render in the UI.
- The legacy Python mutation path in `backend/hardware/commands.py` can finally be deleted.

---

## 2. Preconditions — verify, do not assume

1. `v04` parity assertions pass. If they do not, **stop** — rerouting the UI onto an unproven bus
   converts a contained problem into a broken product.
2. `v05` telemetry, `v06` capability, `v07` headless runtime, `v11` mechanics, `v12` software all
   exist and their bench cases pass.
3. Read `src/components/hardware-workspace.tsx` in full (69 KB) and produce an inventory of every
   responsibility it holds. Save it as `bench/cases/meta/ui/workspace-inventory.json`. **This is
   your acceptance baseline: every responsibility in the inventory must exist in the new
   composition.**
4. Record the exact Playwright specs that cover the workspace and their current pass counts:
   `hardware.spec.ts`, `canvas-*.spec.ts`, `breadboard-view.spec.ts`, `wiring-regression.spec.ts`,
   `mini-breadboard-alignment.spec.ts`, `schematic.spec.ts`-equivalents, `instruments.spec.ts`,
   `connection-check.spec.ts`, `invoices`-of-tests listed in `playwright.config.ts`. Save the
   list.
5. Read `src/index.css`, `src/ui-theme.css` and `src/components/hardware-workspace.css` — the
   visual language must not drift.

---

## 3. What to build

### 3.1 `src/lib/bus-client.ts`

The single frontend entry point for every mutation.

```ts
invoke(name, args, { projectId, expectedRevision }) → Promise<ToolResult>
```

- Calls the FastAPI adapter for `packages/toolbus` (`POST /api/tool`).
- Retries **once**, and only for `REVISION_STALE`, after re-reading the project.
- Emits a `wireup-bus-event` window event for the activity feed and the 3D room (`v10`).
- Scrubs runtime tokens from anything it surfaces.
- Contains **no** project-specific logic. No `if (name === "add_component")` anywhere in the app
  outside this file and the panels that render results.

### 3.2 `src/state/` — one store

- `useGraph(projectId)` — subscribes to graph updates, exposes selectors from
  `packages/core/graph`.
- `useTelemetry(projectId, trialId?)` — live samples, ring-buffered, downsampled for render.
- `useCapability()` — the generated capability document, so every panel can be honest.
- `useSession()` — the current user/session identity.

**Delete** duplicated local state: the canvas's own component copy of the project, the instruments'
private result buffer, the workspace's mutation queue. All derive from the bus.

### 3.3 `src/components/bench/` — the split

Replaces `hardware-workspace.tsx`. One focused file per responsibility from §2.3's inventory:

```
bench/
├─ BenchShell.tsx            // layout, slots, keyboard, undo/redo
├─ CatalogPanel.tsx          // search, groups, "simulated only" filter
├─ Canvas.tsx                // 2D placement, drag, rotate, selection
├─ BreadboardView.tsx        // (wraps the existing component)
├─ WireLayer.tsx             // drawing, routing, waypoints
├─ SchematicPanel.tsx        // (wraps schematic-canvas / schematic-studio)
├─ FirmwarePanel.tsx         // Monaco, compile, diagnostics, upload
├─ InspectorPanel.tsx        // selected part properties, pins, signals
├─ TelemetryPanel.tsx        // live channels, quality badges, recording indicator
├─ TrialPanel.tsx            // goals, sweeps, verdicts, charts
├─ BomPanel.tsx              // build list, prices, wiring table, assembly steps
├─ SimulationPanel.tsx       // driver switch (headless/browser), start/stop/probe
└─ ActivityFeed.tsx          // bus events as a checklist
```

Each is independently testable and under 800 lines. `BenchShell` composes them and owns nothing
else. **The existing `breadboard-view.tsx`, `schematic-canvas.tsx`, `schematic-studio.tsx` and
`hardware-instruments.tsx` are wrapped, not rewritten** — they work and they are tested.

Visual parity is mandatory: screenshot the existing workspace before and after and assert the
diff is limited to the intentionally new panels. Add that as a Playwright visual comparison.

### 3.4 Deleting the legacy path

Only after the UI is on the bus and every spec passes:

- Remove the mutation branches from `backend/hardware/commands.py` that the bus now owns.
- Keep the HTTP route as a thin deprecated adapter for one release, marked in
  `contracts/tools/*.tool.json` with `"deprecated": true`.
- Keep `backend/agent.py` working exactly as it does — the in-app chat agent is a **consumer** of
  the bus (`v04` §3.6), not a separate path. Its questions, feasibility card and build guide must
  all still work; assert with the existing specs.

### 3.5 New surfaces the vision requires

- **Mechanics view** — a small 3D pane inside the bench showing the mechanical part of the graph
  (`apps/room` primitives reused, not duplicated), with live telemetry overlays. Honest placeholder
  for kinds with no geometry, per `v10` rule 3.
- **Software workspace** — clicking a `software.computer` node opens its apps in a sandboxed
  preview (`v12`), with the probe results alongside.
- **Trial view** — goal, sweep parameters, per-run verdicts, and the winning configuration. Charts
  via `recharts` (already a dependency). **Charts show measured data only**; `assumed` series are
  visually distinct and labelled.
- **Capability badges** — anywhere a part is shown, its `simulated` / `placement_only` /
  `unavailable` status is visible. This is invariant I6 rendered.

### 3.6 Test-suite parity

Update `tests/*.spec.ts` **only where the DOM contract genuinely changed**, and keep every existing
assertion's intent. New specs required:

- `tests/bus-single-path.spec.ts` — intercept all network calls during a full edit session; assert
  every mutation went to `/api/tool`.
- `tests/telemetry-quality.spec.ts` — no `assumed` sample renders without its badge.
- `tests/capability-honesty.spec.ts` — a `placement_only` part shows its badge everywhere it
  appears.
- `tests/trial-verdict.spec.ts`.
- `tests/mechanics-view.spec.ts`, `tests/software-view.spec.ts`.

---

## 4. Files

**Create:** `src/lib/bus-client.ts`, `src/state/**`, `src/components/bench/**`, new specs listed
in §3.6, `bench/cases/meta/ui/workspace-inventory.json`.

**Modify:** `src/App.tsx`, `src/components/platform-home.tsx`, `src/index.css`,
`src/hardware/runtime.ts` (publish to the bus instead of its private buffer — behaviour preserved),
`backend/hardware/commands.py` (deprecate), `backend/app.py`, `playwright.config.ts`,
`docs/ARCHITECTURE.md`.

**Delete:** `src/components/hardware-workspace.tsx`, `src/components/hardware-workspace.css`
(folded into per-panel CSS), `src/components/hardware-instruments.tsx` (replaced by
`TelemetryPanel` + `SimulationPanel`, keeping every capability it had).

**Do not touch:** `src/components/breadboard-view.tsx`, `src/components/schematic-canvas.tsx`,
`src/components/schematic-studio.tsx`, `src/components/build-guide.tsx`,
`src/components/instructions-guide.tsx`, `src/hardware/spice.ts`, `backend/agent.py`,
`packages/**`, `services/**`, `vendor/**`.

---

## 5. APPROVED DEPS

None. `recharts`, `zustand`, `monaco-editor` and `@xterm/xterm` are already present.

---

## 6. Acceptance criteria

- **A1** **The invariant test:** a full interactive session (place a part, wire it, edit firmware,
  compile, run, undo, redo, delete) issues **every** mutation through `/api/tool`. Assert by
  intercepting `fetch`. A direct call to `/api/hardware/project/*/command` from app code fails the
  test.
- **A2** Every responsibility in `workspace-inventory.json` is present in the new composition, and
  every existing Playwright spec still passes with an **identical count**.
- **A3** No file in `src/components/bench/` exceeds 800 lines; `bench/known-oversize.txt` shrinks
  and the file-size check passes.
- **A4** Visual parity: the before/after screenshot diff of the default workspace is limited to the
  new panels (assert against a named allowlist of changed regions).
- **A5** Telemetry renders live during a run, with quality badges; no `assumed` value appears
  without one.
- **A6** Capability badges appear on every part surface, and a `placement_only` part's badge text
  matches `contracts/capability.json`.
- **A7** The in-app chat agent still works end to end: questions, feasibility card, approval,
   build, "Build it yourself" section. Assert with the existing chat/feasibility specs.
- **A8** Trials UI: a bench trial run shows its sweep and verdict, and the verdict matches
  `contracts/trial.schema.json` exactly.
- **A9** Software view: clicking the laptop opens a real sandboxed app that runs.
- **A10** No frontend code contains a hardcoded tool list, an error message from the backend, or a
  capability string. Assert with a grep-based check in `scripts/check-ui-hygiene.mjs`.
- **A11** Accessibility: full keyboard operation of build → compile → run, focus management on
  panel open/close, and `prefers-reduced-motion` respected in the 3D views.

---

## 7. Verification

```powershell
npm run build
npm run lint
npm run core:test
npm test -- --workers=1
node bench/run.mjs
node scripts/python.mjs -m pytest backend/tests -q
npm run mcp:smoke
```

Plus: paste the before/after spec count table and the network-interception log from A1.

---

## 8. Out of scope

- Redesigning the visual language. New panels must match the existing theme.
- Any new solver or backend capability.
- Making the room the primary UI. It is navigation; the bench remains the workspace.
- Offline mode, service workers, or mobile layouts.
- Deleting `backend/agent.py`. It stays.

---

## 9. If you are blocked

This phase is large and the most likely place for an agent to break a working product. If the full
split cannot be completed safely, **split the phase**: land the bus rewiring (A1) with the existing
monolith underneath, then split the file in a follow-up recorded under `GAPS`. A correct monolith
on the bus is strictly better than a broken split.

If a Playwright spec fails after the split, determine whether the spec asserts **behaviour** or
**DOM structure**. Behaviour failures are real regressions — fix the code. DOM structure failures
with the same behaviour are spec churn — update the spec minimally, and list every updated spec in
`DEVIATIONS` with an explicit justification. Do not delete a spec to make the suite green.

If a god file cannot be brought under 800 lines without contortion, split on a real seam
(responsibility, not line count) and record the remaining size under `GAPS`.

---

## 10. Final report

`docs/phase-reports/v13_ui_unification.md`: `BASELINE`, `WORKSPACE_INVENTORY` (the §2 map, each
responsibility → new home), `SINGLE_PATH_EVIDENCE` (the A1 interception log), `SPEC_PARITY` (the
before/after table), `ACCEPTANCE` table, `PERFORMANCE`, `EXISTING_TESTS`, `ESCALATION`, `GAPS`,
`DEVIATIONS`.