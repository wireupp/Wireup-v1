# mechanics/boat-speed

**Human intent.** *"Make a boat that goes at a fixed speed in water."* This is the case the whole
platform is for. A hull, two thrusters, a declared PWM command, water — and a speed that is
**measured**, not asserted.

**Acceptance thresholds.**

| Assertion | Threshold |
|---|---|
| Per-thruster force | within 1% of `gain * (duty - deadband) / (1 - deadband)` |
| Steady surge speed | within 5% of `sqrt(thrust / k)`, over the final 30% of the run |
| Steady-state spread | below 2% of the mean |
| Speed quality tag | `measured`, never `assumed` |
| Derived channels | Froude and GM reported as `derived`, and the declared Froude step not crossed |

**Why the expected speed is not read off the simulation.** `check.mjs` recomputes

```
thrust   = 2 * 12 N * (0.087 - 0.05) / (1 - 0.05)          = 0.9333 N
k_surge  = 0.5 * 1000 * 0.006 * 0.216                       = 0.648  N/(m/s)^2
v_steady = sqrt(0.9333 / 0.648)                             = 1.200  m/s
```

from the coefficients the *project* declares. The assertion compares the recording to that
number. A solver that invented resistance to make a boat "look fast" would fail A3 immediately.

**Why 120 seconds.** The surge time constant is `m_eff / (2 k v) = 13.2 / (2 * 0.648 * 1.2) =
8.5 s`. A 20-second run would measure a hull still accelerating and call it a speed. The run is
long enough that the steady-state window contains no transient.

**What is approximated, and therefore visible.** The surge drag coefficient `Cd = 0.006` and
the reference area are **declared, not measured**. The planing step at `Fn = 0.6` is a declared
discontinuity, and A6 asserts it did not fire during the measurement window (`Fn = 0.40`
here). Metacentric height uses a rectangular waterplane. There is no CFD, no cavitation, no
free surface, no structural deformation and no multi-hull interaction — all declared
unavailable in `packages/solvers/mechanics/solver.mjs`.

**What this case does NOT claim.** That a real hull with these coefficients would make 1.2 m/s.
It claims that the platform integrates its declared model reproducibly and reports the result
with an honest quality tag. Real hull resistance comes from tank testing; until that data is
attached, `Cd` is an assumption and this file says so.