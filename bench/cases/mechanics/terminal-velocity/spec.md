# mechanics/terminal-velocity

**Human intent.** Drag has one honest closed form: a body falling through a fluid settles at
`v_t = sqrt(2mg / (rho Cd A))`. If the solver cannot hit that number using the coefficients the
project declared, then the drag coefficient is a fit and every speed the platform reports is
decorative.

**Acceptance thresholds.**

| Assertion | Threshold |
|---|---|
| Settled speed | within 5% of `sqrt(2mg/(rho Cd A))` |
| Monotone descent after settling | no increase in the last 5 s |
| Quality tag | every velocity sample is `measured` |

**Setup.** A 0.5 kg sphere, `Cd = 0.47`, reference area `0.00785 m^2`, dropped through still
water at `rho = 1000`. The water surface is declared far above the body so that the water body
provides a fluid density for drag without the body acquiring buoyancy — a `mech.body` has no
sample points and therefore no buoyancy term at all.

**What this does not test.** Reynolds-number-dependent `Cd`, added mass, or wake interaction.
Those are declared unavailable or approximated in `contracts/derivations.json`, not verified
here.