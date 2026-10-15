# mechanics/drone-hover

**Human intent.** A quadrotor in real air: four rotors, a declared altitude-hold loop, a wind,
and a ground it can sit on.

**Acceptance.**

| Assertion | Threshold |
|---|---|
| Held altitude | within 3% of the declared setpoint |
| Rotor thrust | within 2% of `Ct*rho*A*v_tip^2`, recomputed from the *measured* rpm |
| Force against wind | within 2% of `0.5*rho*Cd*A*v^2`, strictly monotonic in wind speed |

## The honest part: what "required thrust" means here

The brief asked for *"increasing wind increases the required thrust monotonically"*. This solver
has a **vertical altitude loop only**: there is no attitude controller, no tilt, no horizontal
position hold, and no rotor-inflow model. In that model wind does not change the vertical thrust
required to hold an altitude — asserting that it does would be asserting a physical effect this
solver does not implement.

So the assertion is made about the quantity the model *does* compute honestly: **the force the
airframe must fight** to hold station, `0.5*rho*Cd*A*|v - v_wind|*(v - v_wind)`. At the start of
each run the airframe is at rest in the wind, which is exactly the worst case for station
holding. Three wind speeds (2, 5, 9 m/s) are flown and the peak drag is compared against the
closed form and checked for monotonicity.

This is recorded as a `DEVIATION` in the phase report. When an attitude controller exists, the
real hover-thrust-versus-wind assertion becomes possible and should replace this one.

## Why the loop parameters look the way they do

Thrust scales with the square of rpm, and rpm scales with the commanded signal, so
`thrust = 11.9 * command^2 N`. Hover needs `0.8 * 9.80665 = 7.85 N`, i.e. `command = 0.812`.
A proportional altitude law with gain `g` therefore has its equilibrium at
`setpoint - 0.812/g`; with `g = 100` that is 4.99 m, inside the 3% band. `linear_damping = 25`
gives a damping ratio of about 0.32 — without it the loop is undamped, and an undamped
oscillation whose *mean* happens to equal the setpoint would be a much weaker claim than a
drone that has settled.

## Declared approximations

`Ct = 0.11`, blade area, `Cd = 1.0` and reference area are **declared, not measured**. Air density
comes from the ISA troposphere at the declared altitude, not from weather. Ground effect, rotor
inflow, blade flapping and rotational flow are declared **unavailable**, not approximated.