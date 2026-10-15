# mechanics/coupling

**Human intent.** This is the case the product exists for: *a pin on a microcontroller produces a
force, and the physics changes what the firmware does next.* Both directions, in one run, with no
manual step between them.

```
physics ──▶ depth.m / baro.pa telemetry ──▶ declared control law ──▶ trim.pwm ──▶ force on the hull
```

**Acceptance.**

| Assertion | Threshold |
|---|---|
| Reverse direction | barometer equals `p0 + rho*g*keel_depth` at peak and trough, within 2%; the reading moves |
| Forward direction | the PWM saturates while the hull is far from setpoint, and in steady state matches `gain*(setpoint - measured_depth)` to within 0.02 |
| Loop closure | settled depth within 5% of the declared setpoint |
| Force | equals the declared transfer function applied to the measured signal, within 5% |

**What "firmware" is here.** A `mech.control_law` with a declared gain, setpoint and output
bounds. It is NOT compiled firmware: headless firmware execution is unavailable on this platform
(the v07 phase report established that neither Node's permission mode nor WSL can enforce the
network boundary a worker needs), so the solver calls this a *declared control law* and the
`mech.pwm_source` kind's own notes say it is a declared open-loop command rather than firmware
output. The v13/v15 phases must not relabel either of them.

**Why the gain is 400.** The plant is stiff: the hull's hydrostatic restoring force is
`rho*g*A = 2118 N/m`, so a proportional gain of 8 N/m of error moves the operating point by only
about 0.01 m. A high gain plus declared heave damping gives a closed loop that settles inside the
run. This is a tuning choice, visible in the project file, not a hidden fudge.

**Cold start.** On the first step no sensor has published yet. The law emits its declared
`initial_output` (0) until the first reading arrives — a declared value the report can show, not
a guessed one.