# Phase v10 — Room shell and focused runtime details

## BASELINE

- Branch: `v2`.
- The existing `/room/:projectId` route rendered saved legacy hardware components and wires as a 3D view. Selecting a component only showed a small information card.
- The room did not query runtime results. Its status copy said the room runtime was disconnected.
- `contracts/capability.json` still has `generator_status: "stub"`. The visible RC Car project uses an Arduino Uno, L293D driver, IR receiver, and battery; the room labels the driver and receiver placement-only.
- The repository has no mechanics solver, software solver, or headless runtime-worker. No validated motor CAD model or vehicle speed/RPM/torque telemetry is available.

## CHANGES

- `src/components/room-shell.tsx` — added an explicit Open action and double-click entry to a component-focused page; selection remains separate from navigation. The room scene stays mounted behind the page, preserving its camera state. Updated the room status copy to distinguish saved data from runtime results.
- `src/components/room-focus.tsx` — added component wiring details and a read-only, one-second poll of the existing acknowledged browser-runtime result command. The response is validated before display. CPU cycles and pin states are shown only after a compiled artifact has run; simulated time is derived from cycles / clock frequency. Runtime errors and unsupported states are visible.
- The focused page clearly states that MCU/electronics readings are not vehicle speed, RPM, torque, or acceleration. Mechanics availability is derived from the generated capability document, not inferred from component names.
- `docs/ARCHITECTURE.md` — documented the partial legacy room behavior and its unavailable physics/software capabilities.
- No dependency added.

## ACCEPTANCE

| Assertion | Result |
|---|---|
| Open a focused component page without losing the room | **PASS** — a real pointer interaction opened and closed the page in the shared browser; the room remained mounted |
| Read actual browser runtime results | **PASS, limited** — the project runtime acknowledged reads and reported `Connected · idle`; no compiled artifact had run, so no runtime measurements were shown |
| Never label idle zeros as measured results | **PASS** — the idle/no-artifact state displays that no run measurements exist |
| Keep vehicle measurements honest | **PASS** — vehicle metrics remain explicitly unavailable; MCU readings are not presented as motion |
| Render every graph node/kind and assert scene-graph parity | **NOT RUN** — the current room still consumes legacy hardware-project data, not the universal graph |
| Exact motor CAD and validated mechanics | **NOT AVAILABLE** — no verified CAD/model source or mechanics solver exists in this checkout |
| `computer`/website application workspace | **NOT AVAILABLE** — no software solver or `software.computer` graph kind exists |

## EXISTING_TESTS

- `npm run build`: **PASS** (`tsc -b && vite build`).
- `node_modules\\.bin\\oxlint src\\components\\room-shell.tsx src\\components\\room-focus.tsx`: **PASS**.
- `git diff --check`: **PASS**.
- Manual browser acceptance: **PASS, limited** — opened focused Arduino details; verified the acknowledged runtime was idle with no artifact and the UI disclosed that no run measurements existed; returned to the room.
- Scene-graph benchmark, mechanics bench, software sandbox tests, full lint, and full Playwright suite: **NOT RUN**.

## ESCALATION

**RED — partial room delivery only.** This adds a focused, read-only view of real browser-emulator state but does not complete v10 or satisfy the requested RC-car world simulation. The room does not start simulation, and no physical vehicle telemetry is claimed.

## GAPS

- The route still renders the legacy hardware project shape rather than `packages/core/graph`; MCP mutations are not subscribed into the scene.
- There is no verified motor model, exact CAD, mechanics solver, actuator coupling, or vehicle telemetry.
- There is no laptop/computer software node, sandboxed website solver, website preview, or website-to-device bridge.
- The room UI does not offer a validated `speed`, `RPM`, `torque`, or `acceleration` stat until mechanics capabilities and telemetry are implemented and exercised.
- A dedicated regression test for focus navigation and the runtime-result states is still needed; current UI evidence is from the shared browser session.
- Existing world sequence prerequisites remain incomplete: production ToolBus integration/parity, generated capability, headless runtime, and the v09/v11/v12 services.

## DEVIATIONS

- The existing room is implemented in `src/components/room-shell.tsx`, not the standalone `apps/room/` Vite entry specified by v10. The focused view follows that existing route rather than introducing a second room application.
- Queried the existing browser runtime read command instead of inventing a telemetry feed. No simulation is started by the room.
