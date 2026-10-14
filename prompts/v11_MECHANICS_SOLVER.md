# v11 — MECHANICS, ACTUATORS AND ENVIRONMENTS

**Goal:** make the boat and the drone real. Rigid-body physics, buoyancy, drag, aerodynamics, a
weather-and-water environment, and the crucial bridge: **a microcontroller pin drives a physical
force**, and **measured forces move the simulated body**.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0, **I5**, **I9**, **I10**. Two additional:

1. **No fake physics.** If a quantity is approximated (a drag coefficient, a water density), it is
   declared in `contracts/derivations.json`, marked `quality:"derived"`, and reported in the
   build report. A boat that "moves" because of an unexamined fudge factor is worse than a boat
   that honestly does not move.
2. **Never let physics and firmware disagree silently.** If the firmware commanded 60% thrust and
   the body did not accelerate, the run must be able to show that mismatch. That is the whole point
   of coupling them.

---

## 1. Context

By now: `contracts/port-types.json` defines `mech.force`, `mech.torque`, `mech.linear`,
`mech.angular`, `fluid.pressure` and `env.reference`. `contracts/kinds.json` has the seed kinds.
The `mechanics` and `environment` solvers are registered as **unavailable** manifests from `v06`
with honest `requiredToSupport` text. `v09`'s H1 test asserts that an agent is correctly told
mechanics is unavailable.

This phase makes that manifest true in the other direction: real solvers, real telemetry, and the
capability file regenerates to `simulated:true` **only** for what actually passes the bench.

The reference scenario from the brief: *"make a boat that goes at a fixed speed in water"*. That
must work end to end, headlessly, over MCP, with a measured speed and a build list.

---

## 2. Preconditions — verify, do not assume

1. `v09` H1 passes — the orchestrator currently *correctly* refuses hull work. You will be flipping
   that to a pass; confirm it fails before you change anything.
2. `packages/solvers/protocol.ts` exists; the `mechanics` and `environment` manifests are
   registered as unavailable.
3. `contracts/port-types.json` has the `mech.*`, `fluid.*` and `env.reference` entries; extend the
   registry if a genuinely new type is required and record it as a contract change (AMBER).
4. Read `bench/cases/mechanics/boat-minimal` from `v03` — it is the shape you must make work.
5. Read `packages/core/trials` `runTrial` and `sweepTrial` signatures.

---

## 3. What to build

### 3.1 `packages/solvers/mechanics/` — the physics

- **Engine:** `@dimforge/rapier3d-compat` (WASM, deterministic with a fixed seed).
- **Integrator:** fixed timestep, default 1/240 s, substepped under load with a hard substep cap.
  Semi-implicit Euler is sufficient and is deterministic. Document the choice.
- **Bodies:** rigid bodies with mass, inertia tensor from the declared geometry, and a material.
- **Shapes:** from `contracts/kinds.json` properties — a hull declares `volume`, `length`,
  `beam`, `draft`; the collider is derived. **Never guess a mass.** A node without mass is an
  error, not a default of 1 kg.
- **Joints:** revolute (motors, servos, hinges), fixed (assemblies), distance (cables), prismatic
  (actuators).

**Fluid model for the boat — this is the core of the demo. Implement it explicitly:**

- **Buoyancy:** sample the submerged volume of the hull. Discretise the hull into a documented set
  of sample points (from its geometry); for each, if below the water surface, apply an upward force
  proportional to submerged depth × displaced volume × fluid density × gravity, with a documented
  damping term. Record `contracts/derivations.json` entry: `hull.buoyant_force`.
- **Drag:** decompose velocity into surge/sway/heave relative to the water, apply quadratic drag
  per axis with coefficients declared per hull kind in `contracts/kinds.json` (and stated as
  *derived/estimated*, not measured). Record `hull.drag_force`.
- **Added mass:** a documented multiplier on surge/sway effective mass, default 1.0, exposed as a
  tunable. Record `hull.added_mass`.
- **Planing / displacement regime:** a documented switch on Froude number `Fn = v/√(gL)` that
  raises wetted-surface drag and reduces wave-making penalty above `Fn ≈ 0.4`. If you implement it,
  document the threshold and the discontinuity honestly. **If you do not implement it, say so in
  the manifest's `unavailable`.**
- **Stability:** metacentric-height check at rest, reported as a `warning` when `GM < 0`.

**Aerodynamics for the drone:**

- Lift and drag per rotor from `blade_area`, `rpm` (telemetry-derived), air density, and a documented
  thrust coefficient `Ct`. Record `rotor.thrust`, `rotor.drag`.
- **Ground effect** and **rotor–rotor interaction**: declare them `unavailable` unless implemented.
- Air density from the environment node (altitude + temperature), not hardcoded.

### 3.2 `actuators.ts` — the pin↔force bridge

The heart of the product.

```
TelemetryBus (firmware output)          Node/Edge graph        Rigid body
  pin_write("D5", pwm=0.62)  ──▶  actuator node  ──▶  mech.torque edge  ──▶  motor body
```

- An **actuator** is a node with an input port of type `signal.pwm` / `signal.analog` / `signal.digital`
  and an output port of type `mech.torque` / `mech.force` / `mech.angular`.
- Each physics step, the solver reads the current value of the input signal from the
  `TelemetryBus`, maps it through the actuator's declared transfer function
  (a curve in `contracts/kinds.json`, e.g. `esc_pwm_to_thrust`), and applies the resulting force.
- The transfer function's `deadband`, `saturation` and `curve` are declared data, so a servo
  deadband is modelled, not approximated away.
- Reverse direction: a physical quantity the firmware can read (IMU, barometer, compass) is
  published **back** onto a telemetry channel, so firmware can react to physics. A barometer
  reading changes with the hull's depth. A drone's barometer changes with altitude.
- This bidirectional coupling is what makes `bench/cases/orchestrator/` boats verifiable rather
  than decorative.

### 3.3 `packages/solvers/environment/`

- `env.water_body` — extent, depth, density, temperature, flow field, wave spectrum (a documented
  seeded model: e.g. JONSWAP-lite with three parameters, or flat water; declare which).
- `env.airspace` — wind vector + gust model, air density, temperature, precipitation.
- `env.ground` — friction, restitution, terrain height function.
- **Real weather:** a provider interface with two implementations:
  1. `RecordedProvider` — replays a bundled, timestamped dataset (checked into
     `services/environment/data/` as plain JSON, with provenance and licence in a sibling README).
  2. `LiveProvider` — fetches from an upstream source. **Network egress must be explicit and
     off by default.** It requires an explicit `enable_live_weather` setting and an allowlisted
     host; there is no arbitrary-URL fetch. Record the source, licence and attribution requirements
     under `GAPS` before enabling live mode.

  Every weather-derived value carries its source and timestamp in the telemetry
  (`contracts/telemetry.schema.json` extension: an optional `source` object). A simulation without
  stated provenance is not reproducible.

### 3.4 `packages/solvers/mechanics/manifest.ts` — honesty

Fill in `supports` truthfully. `knownFailures` and `unavailable` must list, at minimum: no CFD, no
cavitation, no structural deformation, no multi-hull interaction, ground effect if unimplemented,
rotor inflow if unimplemented, and the wave model's simplifications.

Regenerate `contracts/capability.json`. `mech.hull`, `mech.thruster`, `env.water_body`,
`env.airspace` become `simulated:true` **only** if their bench cases pass.

### 3.5 Orchestrator integration

Extend `ParsedGoal` (in `services/orchestrator/goal.ts`) with `environment` and mechanical
metric types. The boat goal `"holds 1.2 m/s ±5% over 20 s"` must parse to a metric on channel
`hull.speed_surge_mps` with `direction:"target"`, `tolerance:0.06`, window `[t0,t1]`.

**Flip `v09`'s H1 into a positive test:** a mechanical goal now plans, builds, runs and verifies.
Keep the *infeasible* path tested too — pick a goal that genuinely cannot be met
(*"a submarine drone rated to 300 m depth with this hull"*) and assert it is still refused with a
correct `requiredToSupport`. **The honesty machinery must still work when the platform is capable.**

### 3.6 Bench cases — these are the acceptance

- `bench/cases/mechanics/buoyancy/` — a 1 kg sphere in water. Assert: it displaces its own weight
  (`buoyant_force ≈ mg` at equilibrium within 2%), it oscillates and damps, and the oscillation
  period matches `T = 2π√(m/k)` for the declared `k` within 5%.
- `bench/cases/mechanics/terminal-velocity/` — a falling body in a declared fluid. Assert terminal
  speed matches `√(2mg/(ρ C_d A))` within 5%.
- `bench/cases/mechanics/boat-speed/` — **the headline.** A hull, two thrusters, an ESP32, a
  battery. Firmware sets a PWM. Assert: the hull reaches the commanded speed within tolerance, holds
  it (steady-state metric over the final 30%), and the reported `quality` is `measured`.
- `bench/cases/mechanics/determinism/` — 10 runs, same seed → byte-identical telemetry.
- `bench/cases/mechanics/coupling/` — firmware closes a loop on a barometer reading that changes
  with hull depth; assert the firmware's output changes in response to physics.
- `bench/cases/mechanics/drone-hover/` — a quadrotor holding altitude against declared wind.
  Assert hover altitude error < 3% and that increasing wind increases the required thrust
  monotonically.
- `bench/cases/environment/recorded-weather/` — the recorded dataset replays deterministically,
  and every emitted sample carries source + timestamp.

---

## 4. Files

**Create:** `packages/solvers/mechanics/**`, `packages/solvers/environment/**`,
`services/environment/data/**`, `bench/cases/mechanics/**`, `bench/cases/environment/**`,
`bench/cases/orchestrator/boat/**`.

**Modify:** `contracts/kinds.json` (add `mech.*`, `env.*`, `actuator.*` kinds and transfer curves),
`contracts/port-types.json` (only if genuinely needed), `contracts/derivations.json` (every physics
model), `contracts/telemetry.channels.json`, `packages/solvers/mechanics/manifest.ts`,
`packages/solvers/environment/manifest.ts`, `services/orchestrator/goal.ts`,
`src/components/hardware-workspace.tsx` — **not** modified; the mechanics UI arrives in `v13`.

**Do not touch:** `packages/solvers/circuit/**`, `packages/solvers/mcu/**`, `src/hardware/**`,
`backend/**`, `vendor/**`.

---

## 5. APPROVED DEPS

- `@dimforge/rapier3d-compat`

Nothing else. No CFD library, no fluid solver dependency. If you import one, that is out of scope
and belongs in a later phase.

---

## 6. Acceptance criteria

- **A1** `buoyancy`, `terminal-velocity` and `boat-speed` cases pass with the tolerances stated in
  §3.6.
- **A2** Determinism: 10 identical-seed runs → identical NDJSON hashes, for every mechanics case.
- **A3** Coupling: a PWM of 0.62 on a thruster produces a measurable thrust and hull acceleration
  within the same run, with no manual step.
- **A4** Bidirectional: firmware reads a physics-derived channel and its output changes as a
  result. Assert both directions of telemetry flow.
- **A5** Every physics model that is approximated appears in `contracts/derivations.json`, and
  every telemetry sample derived from one has `quality:"derived"`. A checker asserts there is no
  derived physics channel without a derivations entry.
- **A6** `capability.json` after regeneration lists `mech.*` and `env.*` as simulated, and the
  `unavailable` array still lists CFD, cavitation, ground effect and the wave-model limitations.
- **A7** The orchestrator now verifies a boat goal end to end, headless, over MCP, and returns a
  build list with a `measured` speed and a cited `trial_id`.
- **A8** The **infeasible** mechanical test still refuses correctly, with a specific
  `requiredToSupport`. Honesty did not regress when capability increased.
- **A9** Live weather is **off** by default and the allowlist works: a fetch to a non-allowlisted
  host is refused and recorded.
- **A10** Existing suites unchanged.

---

## 7. Verification

```powershell
npm run build
npm run lint
npm run core:test
npm run contracts:gen
npm run contracts:check
npm run mcp:smoke
node bench/run.mjs
node scripts/python.mjs -m pytest backend/tests -q
npm test -- --workers=1
```

Plus: paste the boat run's telemetry summary and the resulting `BuildReport`.

---

## 8. Out of scope

- CFD, free-surface VOF, spray, breaking waves.
- Structural, thermal or electromagnetic simulation.
- Multi-body hydrodynamics (formation, interaction).
- Real-time performance tuning for interactive rendering — this phase is about headless
  correctness. Interactive mechanics rendering is `v13`.
- Live weather as the default.
- Any change to the electronics solvers.

---

## 9. If you are blocked

Physics will not match textbook constants on the first attempt. When `buoyancy` or
`terminal-velocity` fails:

1. Verify the isolated model against its closed form with a single body and no environment.
2. Verify the timestep: halve it and confirm the answer converges. **Non-convergence means the
   timestep is wrong, not the model.**
3. Only then change coefficients — and every coefficient you change must be declared in
   `contracts/kinds.json` and reported in the build report.

Do **not** nudge a coefficient until a test passes. That produces a simulation that looks right
and teaches nothing, which is exactly what this project must not become.

If Rapier proves non-deterministic across runs on this platform, do not ship physics. Record it and
stop — invariant I9 is not negotiable.

---

## 10. Final report

`docs/phase-reports/v11_mechanics.md`: `BASELINE`, `MODEL` (each physics model with its equation,
its parameters, and its declared quality), `APPROXIMATIONS` (the complete list — this section is
the most important one in the report), `BENCH_RESULTS` (real numbers against theory),
`CAPABILITY_DELTA` (before/after `unsupported` lists), `ACCEPTANCE` table, `EXISTING_TESTS`,
`ESCALATION`, `GAPS`, `DEVIATIONS`.