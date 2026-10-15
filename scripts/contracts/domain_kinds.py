"""The mechanics, environment and software kinds, phase v11 and v12.

These kinds are not in the component catalogue: a hull, a rotor, a water body and a laptop
are not catalogue parts. They are declared here, with the same rules as every other kind —
`simulated` is load-bearing and every claim cites an executable bench case.

Two conventions that matter downstream:

  * `properties` is a flat map of name -> value, and the VALUE carries the type. That is how
    `packages/core/trials` decides whether a property is sweepable: it must be a number.
    Every tunable physics coefficient is therefore a top-level numeric property, not buried
    in a nested object, so `trial.sweep` can move it without a bespoke schema.
  * Nothing carries a mass, a drag coefficient or a transfer curve by default. An absent
    value is an error at build time, named after the offending node — never a plausible
    default, because a plausible default is how a simulation starts lying.

Split out of scripts/contracts/kinds.py when the god-file guard flagged it.
"""

MECH_BENCH = "bench/cases/mechanics"
ENV_BENCH = "bench/cases/environment"
SOFTWARE_BENCH = "bench/cases/software"

_FORCE_OUT = {"name": "force", "type": "mech.force", "direction": "out", "role": None}
_TORQUE_OUT = {"name": "torque", "type": "mech.torque", "direction": "out", "role": None}
_PWM_IN = {"name": "pwm", "type": "signal.pwm", "direction": "in", "role": None}
_PWM_OUT = {"name": "pwm", "type": "signal.pwm", "direction": "out", "role": None}
_ANALOG_IN = {"name": "sig", "type": "signal.analog", "direction": "in", "role": None}
_STREAM_IN = {"name": "sensor", "type": "data.stream", "direction": "in", "role": None}
_STREAM_OUT = {"name": "reading", "type": "data.stream", "direction": "out", "role": None}
_WATER_IN = {"name": "water", "type": "fluid.pressure", "direction": "in", "role": None}
_REF_IN = {"name": "ref", "type": "env.reference", "direction": "in", "role": None}
_REF_OUT = {"name": "ref", "type": "env.reference", "direction": "out", "role": None}

# Every physics model that is approximated rather than exact is named here, so a reader of
# contracts/kinds.json can see the assumption before they read the result.
_APPROXIMATION = ("Approximated: see contracts/derivations.json. ")
_NO_MASS = ("A body with no declared mass_kg is an error, not a 1 kg default. ")


def domain_kinds() -> list:
    """Return the non-catalogue kinds: mechanics, environment and software."""
    return [
        # ----------------------------------------------------------------- mechanics
        {
            "id": "mech.body", "label": "Rigid body", "group": "mechanics",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [],
            "properties": {
                "mass_kg": 1.0, "size_m": 0.1, "linear_damping": 0.0, "angular_damping": 0.0,
                "cd_surge": 0.47, "cd_sway": 0.47, "cd_heave": 0.47,
                "cd_area_surge_m2": 0.00785, "cd_area_sway_m2": 0.00785, "cd_area_heave_m2": 0.00785,
                "ground_contact": False,
                "duration_s": 20.0, "sample_rate_hz": 20.0,
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            },
            "defaults": {"fqbn": None},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/determinism/case.json", f"{MECH_BENCH}/terminal-velocity/case.json"],
            "notes": (_NO_MASS + "Semi-implicit Euler at a fixed 1/240 s timestep, deterministic for "
                      "a fixed graph and seed. Inertia is taken from a declared size_m box or an "
                      "explicit inertia_kg_m2; it is never guessed from mass alone. Declaring the "
                      "Cd and reference area couples the body to the fluid in drag only."),
        },
        {
            "id": "mech.hull", "label": "Boat hull", "group": "mechanics",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [
                {"name": "thrust", "type": "mech.force", "direction": "in", "role": None},
                _WATER_IN, _REF_IN,
            ],
            "properties": {
                "mass_kg": 12.0, "volume": 0.02, "length": 0.9, "beam": 0.24, "draft": 0.12,
                "samples": 6,
                "cd_surge": 0.006, "cd_sway": 0.45, "cd_heave": 0.9,
                "cd_area_surge_m2": 0.216, "cd_area_sway_m2": 1.08, "cd_area_heave_m2": 1.08,
                "waterline_length_m": 0.9, "planing_threshold": 0.4, "planing_drag_factor": 1.35,
                "heave_damping": 40.0,
                "added_mass": {"x": 0.1, "y": 0.8, "z": 1.0},
                "linear_damping": 0.0,
                "duration_s": 30.0, "sample_rate_hz": 20.0,
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            },
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/boat-speed/case.json", f"{MECH_BENCH}/buoyancy/case.json"],
            "notes": (_APPROXIMATION + "Buoyancy from a declared sample-point discretisation of the "
                      "declared volume; quadratic drag with declared Cd and area; declared added "
                      "mass; a STEP change in drag at Froude 0.4. No CFD, no free surface, no "
                      "cavitation, no structural deformation. Metacentric height is reported as a "
                      "warning when GM < 0."),
        },
        {
            "id": "mech.float", "label": "Buoyant float", "group": "mechanics",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_WATER_IN, _REF_IN],
            "properties": {
                "mass_kg": 1.0, "volume": 0.001, "length": 0.1, "beam": 0.1, "draft": 0.1,
                "samples": 24, "diameter_m": 0.1,
                "cd_surge": 0.47, "cd_sway": 0.47, "cd_heave": 0.47,
                "cd_area_surge_m2": 0.00785, "cd_area_sway_m2": 0.00785, "cd_area_heave_m2": 0.00785,
                "heave_damping": 0.0,
                "added_mass": {"x": 0.5, "y": 0.5, "z": 0.5},
                "linear_damping": 0.0,
                "duration_s": 20.0, "sample_rate_hz": 50.0,
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            },
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/buoyancy/case.json", f"{MECH_BENCH}/terminal-velocity/case.json"],
            "notes": (_APPROXIMATION + "A prismatic float used to verify Archimedes and terminal "
                      "velocity against closed form. Terminal velocity assumes Cd = 0.47, the "
                      "declared value for a sphere, not a fitted one."),
        },
        {
            "id": "mech.airframe", "label": "Airframe", "group": "mechanics",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_REF_IN],
            "properties": {
                "mass_kg": 0.8, "size_m": 0.2, "cd": 1.0, "area_m2": 0.04,
                "linear_damping": 0.0, "angular_damping": 0.0,
                "duration_s": 30.0, "sample_rate_hz": 20.0,
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            },
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/drone-hover/case.json"],
            "notes": ("Translational quadratic drag in the wind frame. Cd and reference area are "
                      "declared, not measured; no blade-element or vortex model."),
        },
        {
            "id": "mech.rotor", "label": "Rotor", "group": "mechanics",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [{"name": "mount", "type": "mech.force", "direction": "in", "role": None}, _REF_IN],
            "properties": {
                "diameter_m": 0.127, "blade_area_m2": 0.00125, "thrust_coefficient": 0.11,
                "induced_drag_factor": 0.318, "rpm": 0.0, "direction": 1, "max_rpm": 12000.0,
            },
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/drone-hover/case.json"],
            "notes": ("Free-air disc model: T = Ct*rho*A*v_tip^2. Ground effect and rotor-rotor "
                      "interaction are declared unavailable, not approximated."),
        },
        {
            "id": "actuator.thruster", "label": "Thruster", "group": "actuator",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_PWM_IN, _FORCE_OUT],
            "properties": {
                "axis": "x", "mode": "force",
                "transfer": {"curve": "linear", "deadband": 0.05, "saturation": 0.95, "gain": 12.0},
            },
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/coupling/case.json", f"{MECH_BENCH}/boat-speed/case.json"],
            "notes": ("The pin-to-force bridge. Deadband, saturation and curve are declared data, "
                      "so an ESC deadband is modelled rather than approximated away. Gain is in newtons "
                      "at full signal and is never inferred from the power supply."),
        },
        {
            "id": "actuator.servo", "label": "Servo", "group": "actuator",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_PWM_IN, _TORQUE_OUT],
            "properties": {
                "axis": "z", "mode": "torque",
                "transfer": {"curve": "linear", "deadband": 0.02, "saturation": 1.0, "gain": 0.4,
                             "bidirectional": True},
            },
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/coupling/case.json"],
            "notes": "Bidirectional: signal 0.5 is neutral and the gain is in N*m at full deflection.",
        },
        {
            "id": "actuator.force", "label": "Force actuator", "group": "actuator",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_ANALOG_IN, _FORCE_OUT],
            "properties": {
                "axis": "z", "mode": "force",
                "transfer": {"curve": "linear", "deadband": 0.0, "saturation": 1.0, "gain": 1.0},
            },
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/coupling/case.json"],
            "notes": "Applies a declared force from an analogue signal. Nothing is inferred.",
        },
        {
            "id": "mech.pwm_source", "label": "Declared PWM source", "group": "actuator",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_PWM_OUT],
            "properties": {"duty": 0.62},
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/boat-speed/case.json"],
            "notes": ("An open-loop PWM command standing in for firmware output. It is NOT compiled "
                      "firmware: headless firmware execution is unavailable (see the v07 report), and "
                      "this node is labelled a declared source so a report cannot mistake it for one."),
        },
        {
            "id": "mech.control_law", "label": "Declared control law", "group": "actuator",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_STREAM_IN, _PWM_OUT],
            "properties": {"setpoint": 0.0, "gain": 0.0, "integral_gain": 0.0, "min": 0.0, "max": 1.0,
                           "initial_output": 0.0, "source_channel": "self.input",
                           "output_channel": "self.output"},
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/coupling/case.json"],
            "notes": ("A declared proportional (optionally PI) law closing a loop on a "
                      "physics-published sensor channel. The reverse direction of the coupling: "
                      "physics writes the channel, the law reads it, the actuator applies the force."),
        },
        {
            "id": "mech.barometer", "label": "Barometer", "group": "sensor",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [{"name": "body", "type": "mech.linear", "direction": "in", "role": None},
                      _STREAM_OUT],
            "properties": {},
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/coupling/case.json"],
            "notes": ("Hydrostatic pressure from the body's declared depth: p = p0 + rho*g*h. Exact "
                      "for a submerged body; no device noise, no temperature compensation."),
        },
        {
            "id": "mech.depth_sensor", "label": "Depth sensor", "group": "sensor",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [{"name": "body", "type": "mech.linear", "direction": "in", "role": None},
                      _STREAM_OUT],
            "properties": {},
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/coupling/case.json"],
            "notes": "Free-surface depth relative to the declared water surface.",
        },
        {
            "id": "mech.imu", "label": "IMU", "group": "sensor",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [{"name": "body", "type": "mech.angular", "direction": "in", "role": None},
                      _STREAM_OUT],
            "properties": {},
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/coupling/case.json"],
            "notes": ("Specific force a - g along the declared axis, with no bias, noise or "
                      "sample-and-hold. Real IMU error is not modelled."),
        },
        {
            "id": "mech.compass", "label": "Compass", "group": "sensor",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [{"name": "body", "type": "mech.angular", "direction": "in", "role": None},
                      _STREAM_OUT],
            "properties": {},
            "defaults": {},
            "solver": "mechanics", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/coupling/case.json"],
            "notes": "Yaw derived from the body quaternion. Declared derived, not measured.",
        },
        # --------------------------------------------------------------- environment
        {
            "id": "env.water_body", "label": "Water body", "group": "environment",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_REF_OUT],
            "properties": {
                "surface_z": 0.0, "density": 1000.0, "kinematic_viscosity": 1e-06,
                "temperature_c": 15.0, "wave_model": "flat",
                "wave_parameters": {"components": []},
                "flow": {"x": 0.0, "y": 0.0, "z": 0.0},
            },
            "defaults": {},
            "solver": "environment", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/boat-speed/case.json", f"{ENV_BENCH}/recorded-weather/case.json"],
            "notes": ("Declared extent, density and a single uniform flow vector. No tidal, geostrophic "
                      "or eddy fields. wave_model is 'flat' by default; 'seeded_sinusoid' is a sum of "
                      "declared sinusoids and is NOT a wave spectrum."),
        },
        {
            "id": "env.airspace", "label": "Airspace", "group": "environment",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_REF_OUT],
            "properties": {
                "altitude_m": 0.0, "wind": {"x": 0.0, "y": 0.0, "z": 0.0},
                "gust_model": "steady", "temperature_k": 288.15, "precipitation": "none",
            },
            "defaults": {},
            "solver": "environment", "simulated": True, "scope": "headless",
            "evidence": [f"{MECH_BENCH}/drone-hover/case.json", f"{ENV_BENCH}/recorded-weather/case.json"],
            "notes": ("Wind vector plus air density from the ISA troposphere. Live weather is disabled: "
                      "the recorded dataset is the only source unless an explicit host allowlist is "
                      "configured. No gust turbulence model beyond the declared gust_model."),
        },
        {
            "id": "env.ground", "label": "Ground", "group": "environment",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_REF_OUT],
            "properties": {"height_m": 0.0, "friction": 0.6, "restitution": 0.1},
            "defaults": {},
            "solver": "environment", "simulated": True, "scope": "headless",
            "evidence": [f"{ENV_BENCH}/recorded-weather/case.json"],
            "notes": "A declared height, friction and restitution. No DEM, no terrain profile.",
        },
        # ------------------------------------------------------------------ software
        {
            "id": "software.computer", "label": "Computer", "group": "software",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [{"name": "apps", "type": "data.stream", "direction": "in", "role": None}],
            "properties": {
                "memory_mb": 8192, "cores": 4, "os": "linux",
                "network": {"allowlist": [], "deny_internet": True},
            },
            "defaults": {},
            "solver": "software", "simulated": True, "scope": "headless",
            "evidence": [f"{SOFTWARE_BENCH}/hello-app/case.json"],
            "notes": ("A declared machine that owns software children. deny_internet defaults to true "
                      "and setting it false is refused, not honoured: there is no sandbox network "
                      "egress policy to grant."),
        },
        {
            "id": "software.web_app", "label": "Web app", "group": "software",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [{"name": "http", "type": "net.http", "direction": "out", "role": None},
                      _STREAM_IN, {"name": "asset", "type": "data.file", "direction": "in", "role": None}],
            "properties": {"entry": "index.html", "files": {
                "index.html": "<!DOCTYPE html><html><head><title>self test</title></head>"
                              "<body><p id=\"self-test\">served</p></body></html>",
            }, "framework": "vanilla", "dom_operations": [
                {"id": "served", "op": "exists", "selector": "#self-test",
                 "expression": "value", "expect": {"op": "eq", "value": True}},
            ]},
            "defaults": {},
            "solver": "software", "simulated": True, "scope": "headless",
            "evidence": [f"{SOFTWARE_BENCH}/hello-app/case.json", f"{SOFTWARE_BENCH}/dom-assert/case.json"],
            "notes": ("Served from a loopback static server under a strict CSP and probed by static "
                      "DOM analysis. Client-side JavaScript is NOT executed, so a page that renders "
                      "only after a script runs is unverifiable here. Inline event handlers, "
                      "javascript: URLs, remote script sources and iframes are refused before serving."),
        },
        {
            "id": "software.script", "label": "Telemetry script", "group": "software",
            "legacy_type": None, "tagName": None, "derived_by": "scripts/contracts/domain_kinds.py",
            "ports": [_STREAM_IN, _STREAM_OUT],
            "properties": {"probes": [{"id": "self", "target": {"node": "self"}, "expression": "1",
                                     "timeout_ms": 1000}],
                           "timeout_s": 5},
            "defaults": {},
            "solver": "software", "simulated": True, "scope": "headless",
            "evidence": [f"{SOFTWARE_BENCH}/script/case.json", f"{SOFTWARE_BENCH}/limit/case.json"],
            "notes": ("A declared program evaluated by the same bounded, side-effect-free expression "
                      "evaluator the trial probes use: no I/O, no network, no filesystem, no eval, "
                      "not Turing complete. It is NOT a general-purpose interpreter and does not run "
                      "Python or Node."),
        },
    ]