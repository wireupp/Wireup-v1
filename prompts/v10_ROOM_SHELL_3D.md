# v10 — THE ROOM (3D SHELL)

**Goal:** the room. A navigable 3D space containing a bench, a laptop, water and sky, where every
object is a node in the graph. Clicking an object expands it into its real workspace — click the
laptop and you are in the software sim; click the bench and you are in the existing 2D circuit
editor. Clicking the boat takes you to its mechanics view.

This is the surface that makes the product legible to a human in five seconds.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0 and §3. Three hard constraints on this phase:

1. **The 3D view is derived, never authoritative.** It renders `Graph` and emits intents. It holds
   no state of its own. If a node moves in 2D, the 3D updates. If nothing exists in the graph, it
   is not in the room.
2. **Never gate existing functionality behind the room.** The 2D workspace keeps working exactly
   as it does. The room is an additional navigation surface.
3. **Never fabricate geometry.** A node kind without a mesh renders as an honest placeholder —
   labelled with its kind, marked `unrenderable`, listed in a small on-screen notice. No invented
   detailed models.

---

## 1. Context

`three` and `@react-three/fiber` are already dependencies and are currently used only by
`gradient-orb.tsx`. `contracts/kinds.json` now describes every node kind with its ports and
properties, and `contracts/capability.json` knows which kinds are actually simulated.

The reference experience is a single scene where the user sees their whole setup at once, walks
to a station, clicks into a focused editor, and comes back. Multiple rooms/environments
(`env.reference`-linked water, sky, ground) come in `v11`.

---

## 2. Preconditions — verify, do not assume

1. `contracts/kinds.json` and `contracts/capability.json` exist and are generated.
2. `packages/core/graph` selectors (`byKind`, `roots`, `portsOf`) are available.
3. Read `src/components/platform-home.tsx`, `src/components/project-list.tsx` and
   `src/components/hardware-workspace.tsx` to match the existing visual language: colours, type
   scale, panel chrome, dark theme tokens in `src/ui-theme.css`.
4. Record the current bundle size (`npm run build` output) as a baseline. 3D is the single biggest
   regression risk in this phase.
5. Confirm no existing route changes behaviour. The room is a **new route**.

---

## 3. What to build — `apps/room/`

### 3.1 Structure

`apps/room/` is a standalone Vite entry (`index.html`, `src/`), sharing `packages/*` and
`src/ui-theme.css`. It is a separate bundle, lazily loaded, so the main app does not pay for three.js.

### 3.2 `scene.tsx` — the scene graph

```
<Room>
  <Environment />          // sky, ground, ambient + directional light, day cycle off by default
  <Station name="bench"  → StationNode{ref: root-of-type "workbench"} />
  <Station name="laptop" → StationNode{ref: "computer.*"} />
  <Station name="water"  → StationNode{ref: "env.water_body"} />   // v11 populates; v10 renders a pool
  <Station name="flight" → StationNode{ref: "env.airspace"} />
  <NodeView nodeId />     // one per graph node, positioned
  <FocusCamera targetId />
</Room>
```

Stations are **derived** from node kinds via a small declarative map
(`apps/room/src/stations.ts`), not hardcoded coordinates per project. A station exists if the
project contains a qualifying root node.

### 3.3 `NodeView.tsx` — node rendering

Resolution order, first match wins:

1. A **mesh pack** entry — `apps/room/src/meshes/<kind>.glb`-equivalent (generated geometry or a
   procedural primitive for this phase).
2. A **procedural primitive** from a small table keyed by `contracts/kinds.json` `group`
   (resistor → small cylinder, board → thin box, hull → tapered box, motor → cylinder + shaft).
   Derived from ports: pin count drives instance count, `properties.resistance` etc. drive size.
3. The **honest placeholder**: a labelled, kind-coloured box with a `?` badge, listed in an
   `unrenderable` notice.

Ports render as small clickable nubs. Edges render as tubes: electrical edges as thin coloured
lines, `mech.*` and `fluid.*` edges as thicker ones, `data.*`/`net.*` as dashed. Edge colour comes
from the edge `kind` via `contracts/port-types.json`.

### 3.4 `interaction.tsx`

- Orbit / pan / zoom (the screenshot's "left-drag to orbit, right-drag to pan, scroll to zoom").
- Hover → highlight the node, dim others, show a label with kind and status
  (`simulated` / `placement_only` / `unrenderable` from `capability.json`).
- Click a node → **select**, not navigate. A second click, or a dedicated "Open" affordance,
  navigates. This prevents accidental context loss during exploration.
- Click a port → select the node and highlight connected edges.
- Keyboard: arrow keys to cycle siblings, `Enter` to open, `Esc` to go back.

### 3.5 `focus.tsx` — expand into a workspace

`Enter` on a station node transitions to that node's focused view:

- `workbench` → the existing 2D workspace (embed `src/components/hardware-workspace.tsx` — **do
  not modify it**; wrap it).
- `computer` → the software workspace (`v12`; until then, a panel listing the computer's child
  nodes with their kinds and a clear "software simulation not yet available" from
  `capability.json`).
- `mech.hull` and other mechanical nodes → a placeholder panel showing the node's properties, its
  edges, its telemetry channels from `contracts/telemetry.channels.json`, and the solver status.
  Real mechanics arrive in `v11`.

The back path returns to the room with the camera framing the node it came from. **Camera state is
preserved**, so going in and out is not disorienting.

### 3.6 `sync.tsx` — derived, not authoritative

- The room subscribes to the project's graph via a subscription from `packages/core/graph`
  (`store.subscribe`). Any mutation — from the UI, the in-app agent, or an MCP agent — appears in
  the room within one frame.
- The room emits **intents** only (`{type:"select"}`, `{type:"move", nodeId, position}`), which go
  through the tool bus (`node.modify`). It never mutates the graph directly.
- A mutation originating from an agent shows a brief marker on the affected node. This is how a
  human watching the room sees an AI working.

### 3.7 `telemetry.tsx` — live data in the room

Nodes with active telemetry show a small readout: the channel, value, unit, and a `quality` badge.
`unavailable` channels render as `—` with the reason from `capability.json`. **No invented
waveforms, no interpolated animation of numbers that were not measured.** This is invariant I5
applied to a visual surface, and it is the thing most likely to be gotten wrong.

### 3.8 Performance

- Lazy-load three.js only when the room route is opened.
- One `InstancedMesh` per mesh kind; target 60 fps with 500 nodes.
- Node views beyond a distance threshold drop to the placeholder LOD.
- No shadow maps by default; they are the first thing that kills a software-WebGL machine.
- If WebGL is unavailable, the room renders a clear message and the rest of the app is unaffected.

### 3.9 Route

`/room` and `/room/:projectId`, added to `src/App.tsx` as a lazy route. `PlatformHome` gets one
entry point. **No existing route changes.**

---

## 4. Files

**Create:** `apps/room/**`, `bench/cases/room/**` (scene-graph assertions, not screenshots —
assert the rendered node list matches the graph).

**Modify:** `src/App.tsx` (two lazy routes only), `src/components/platform-home.tsx` (one entry
point), `package.json`, `vite.config.ts` (add the room entry), `docs/ARCHITECTURE.md`.

**Do not touch:** `src/components/hardware-workspace.tsx` (wrap it, do not edit it),
`src/hardware/**`, `src/components/breadboard-view.tsx`, `src/components/schematic-*.tsx`,
`backend/**`, `vendor/**`.

---

## 5. APPROVED DEPS

`three`, `@react-three/fiber`, `@react-three/drei` (new — for controls and helpers), and
`zustand` (already present). **No glTF loader pipeline and no model downloads in this phase** —
procedural geometry only. Record model acquisition under `GAPS`.

---

## 6. Acceptance criteria

- **A1** Room scene graph matches the graph: for a project with N nodes, the rendered node list is
  exactly N, with kinds matching `contracts/kinds.json`. Assert by walking the scene graph, not by
  screenshot.
- **A2** Every kind in `contracts/kinds.json` renders through one of the three resolution tiers,
  and the `unrenderable` list is exactly the set that fell through to tier 3. No kind silently
  disappears.
- **A3** `placement_only` and `unavailable` nodes are visually distinct from `simulated` ones, and
  the label text states the status.
- **A4** Clicking into the workbench mounts the existing workspace and its Playwright specs still
  pass with identical counts.
- **A5** A mutation made through MCP (not the UI) appears in the room within 500 ms, with the
  agent-mutation marker. Test by driving a mutation through `services/mcp/client/reference.ts` and
  observing the scene.
- **A6** Telemetry readouts show only `measured`/`derived` samples; an `unavailable` channel shows
  `—` and its reason. Assert no readout displays an `assumed` value without the badge.
- **A7** 500 synthetic nodes render at ≥30 fps on software WebGL (CI has no GPU). Record the real
  number in the bench case.
- **A8** With WebGL disabled, the room shows a clear message and `/` (the existing home) still
  works.
- **A9** Main-app bundle growth from this phase is **under 150 KB gzipped**, with three.js entirely
  in the lazily-loaded room chunk. Assert from the build output.
- **A10** Camera state survives enter/exit: return from a focused view frames the node it came from.

---

## 7. Verification

```powershell
npm run build
npm run lint
npm test -- --workers=1
node bench/run.mjs
node scripts/python.mjs -m pytest backend/tests -q
```

Plus: paste the build output showing the room chunk size, and one `look`-style screenshot of the
room for the three bench projects.

---

## 8. Out of scope

- Real mechanical geometry, CAD import, or STEP files.
- Environment rendering that depends on weather or water simulation. `v11`.
- Editing firmware, code or the circuit from inside the room — the room navigates to editors, it
  does not embed them all.
- Multiplayer, avatars, or any social element.
- Sound.
- Any mutation path other than the tool bus.

---

## 9. If you are blocked

If `drei` or a control implementation fights the existing setup, write plain three.js controls. A
working room with basic navigation beats a stalled phase.

If procedural geometry looks bad, **make it honest and plain** — flat-shaded primitives with a
clear material. Do not spend this phase on beauty; the vision is proven by structure and
interaction, not by renders. Do not import external 3D assets without an explicit licence
decision — that is a RED item for a human.

If bundle growth exceeds A9, the room is not being lazy-loaded. Fix the loading, do not raise the
threshold.

---

## 10. Final report

`docs/phase-reports/v10_room_shell.md`: `BASELINE` (bundle size, existing counts),
`SCENE_MAPPING` (station → kind, node kind → render tier), `ACCEPTANCE` table, `PERFORMANCE` (the
real fps and the build sizes), `EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.