# mechanics/buoyancy

**Human intent.** A 1 kg body floating in water should sit at the depth where it displaces
its own weight, bob at a period set by the waterplane stiffness, and settle. If the platform
cannot reproduce those three closed-form results, every boat it ever claims to simulate is
fiction.

**Acceptance thresholds.**

| Assertion | Threshold | Derived from |
|---|---|---|
| Settled draft | within 2% of `V_sub / A` | declared `mass_kg`, `density`, `length`, `beam` |
| Displaced volume at rest | within 2% of `m / rho` | declared mass and density |
| Heave period | within 5% of `2*pi*sqrt(m/k)`, `k = rho*g*A` | declared mass, density and waterplane |
| Damping | envelope shrinks > 20% | declared `linear_damping` |

**Why these numbers and not a tolerance that "looks right".** Every expected value is computed
inside `check.mjs` from the project's own declared properties, not from anything the solver
reported. If a coefficient were tuned until the boat looked plausible, A2 and A4 are exactly
the assertions that fail.

**Known limits exercised here.** The buoyancy integral is a declared sample-point sum, so a
hull less than one sample spacing above its keel is quantised. This case declares `[1,1,96]`
vertical samples for that reason; a real hull would declare a mesh instead, and the
`SHALLOW_DRAFT_DISCRETISATION` known failure covers the coarse case.