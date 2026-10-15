"""The authored contract schemas: graph, telemetry, trial, capability, derivations,
port types and the capability stub.

These are written by hand rather than derived, because they are the platform's design,
not a summary of existing code. Everything else in contracts/ is generated.

Split out of scripts/gen-contracts.py when the god-file guard flagged it.
"""

from contracts.common import GENERATED_BY, GENERATOR_VERSION

def graph_schema() -> dict:
    node_id = {"type": "string", "pattern": r"^[a-z][a-z0-9_]*_[a-f0-9]{8}$",
               "description": "Kind prefix plus a short hash, so an id is self-describing in "
                              "an error message."}
    endpoint = {
        "type": "object", "required": ["node", "port"], "additionalProperties": False,
        "properties": {"node": {"type": "string", "minLength": 1, "maxLength": 128},
                       "port": {"type": "string", "minLength": 1, "maxLength": 64}},
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://wireup.dev/contracts/graph.schema.json",
        "title": "WireUp project graph",
        "description": "The universal project model. A circuit, a boat, a drone and a website are "
                       "all graphs of typed nodes. Adding a domain means adding node kinds and a "
                       "solver, never forking this shape.",
        "type": "object",
        "additionalProperties": False,
        "required": ["schema_version", "id", "domain", "revision", "nodes", "edges",
                     "created_at", "updated_at"],
        "properties": {
            "schema_version": {"const": 3,
                               "description": "Incremented only by a phase that migrates every "
                                              "consumer. An unknown value is rejected, never assumed."},
            "id": {"type": "string", "pattern": "^[a-f0-9]{32}$"},
            "name": {"type": "string", "minLength": 1, "maxLength": 120},
            "domain": {"enum": ["electronics", "mechanics", "software", "environment", "hybrid"]},
            "revision": {"type": "integer", "minimum": 0,
                         "description": "Monotonic. Every mutation increments it exactly once and "
                                        "requires the caller's expected_revision to match."},
            "parent_project_id": {"type": ["string", "null"], "pattern": "^[a-f0-9]{32}$"},
            "nodes": {"type": "array", "items": {"$ref": "#/$defs/Node"}},
            "edges": {"type": "array", "items": {"$ref": "#/$defs/Edge"}},
            "metadata": {"type": "object"},
            "artifacts": {"type": "array", "items": {"$ref": "#/$defs/ArtifactRef"}},
            "firmware": {"$ref": "#/$defs/Firmware"},
            "created_at": {"type": "string", "format": "date-time"},
            "updated_at": {"type": "string", "format": "date-time"},
        },
        "$defs": {
            "Port": {
                "type": "object", "required": ["name", "type", "direction"],
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string", "minLength": 1, "maxLength": 64},
                    "type": {"type": "string",
                             "description": "Must exist in contracts/port-types.json. An unknown "
                                            "type is an error naming the port, never coerced."},
                    "direction": {"enum": ["in", "out", "inout"]},
                    "unit": {"type": ["string", "null"]},
                    "required": {"type": "boolean", "default": False},
                },
            },
            "Node": {
                "type": "object", "required": ["id", "kind"], "additionalProperties": False,
                "properties": {
                    "id": node_id,
                    "kind": {"type": "string", "pattern": r"^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$",
                             "description": "group.kind. Must exist in contracts/kinds.json."},
                    "label": {"type": "string", "maxLength": 120},
                    "parent_id": {"type": ["string", "null"],
                                  "description": "Containment. Must not form a cycle."},
                    "position": {"type": "object", "additionalProperties": False,
                                 "properties": {"x": {"type": "number"}, "y": {"type": "number"},
                                                "z": {"type": "number"}}},
                    "rotation": {"type": "number"},
                    "properties": {"type": "object"},
                },
            },
            "Edge": {
                "type": "object", "required": ["id", "from", "to"], "additionalProperties": False,
                "properties": {
                    "id": {"type": "string", "minLength": 1, "maxLength": 128},
                    "from": endpoint, "to": endpoint,
                    "kind": {"type": "string",
                             "description": "Port type carried. Must be compatible with both endpoints."},
                    "value": {},
                    "properties": {"type": "object"},
                },
            },
            "ArtifactRef": {
                "type": "object",
                "required": ["id", "kind", "filename", "sha256", "produced_by"],
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"}, "kind": {"type": "string"},
                    "filename": {"type": "string"}, "media_type": {"type": "string"},
                    "sha256": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
                    "bytes": {"type": "integer", "minimum": 0},
                    "created_at": {"type": "string", "format": "date-time"},
                    "produced_by": {"type": "string"},
                    "source_revision": {"type": "integer", "minimum": 0},
                    "project_revision": {"type": "integer", "minimum": 0},
                },
            },
            "Firmware": {
                "type": "object",
                "required": ["filename", "language", "source", "revision"],
                "additionalProperties": False,
                "description": "One firmware document per project, not per node.",
                "properties": {
                    "filename": {"type": "string", "minLength": 1},
                    "language": {"enum": ["arduino", "python", "c", "javascript", "html"]},
                    "source": {"type": "string", "maxLength": 2000000},
                    "revision": {"type": "integer", "minimum": 0},
                    "target_board": {"type": ["string", "null"]},
                },
            },
        },
    }


def telemetry_schema() -> dict:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://wireup.dev/contracts/telemetry.schema.json",
        "title": "Telemetry sample",
        "description": "One measurement. The quality tag is load-bearing: an 'assumed' sample must "
                       "never be presented as a measurement, and an 'unavailable' sample must "
                       "carry a null value.",
        "type": "object", "additionalProperties": False,
        "required": ["project_id", "t", "node", "channel", "value", "quality", "solver"],
        "properties": {
            "project_id": {"type": "string", "pattern": "^[a-f0-9]{32}$"},
            "trial_id": {"type": ["string", "null"]},
            "seq": {"type": "integer", "minimum": 0},
            "t": {"type": "number", "minimum": 0, "description": "Seconds of simulated time."},
            "node": {"type": "string", "description": "Node id, or '' for environment channels."},
            "channel": {"type": "string", "minLength": 1, "maxLength": 128},
            "value": {"type": ["number", "string", "boolean", "null"]},
            "unit": {"type": ["string", "null"]},
            "quality": {
                "enum": ["measured", "derived", "assumed", "unavailable"],
                "description": "measured: a solver observed the quantity. derived: computed from "
                               "measured values and listed in contracts/derivations.json. assumed: "
                               "a default was substituted. unavailable: not produced; value MUST "
                               "be null.",
            },
            "solver": {"type": "string", "minLength": 1},
            "source": {"type": ["object", "null"],
                       "description": "Provenance for environment-derived values."},
        },
        "allOf": [{
            "if": {"properties": {"quality": {"const": "unavailable"}}, "required": ["quality"]},
            "then": {"properties": {"value": {"type": "null"}}},
        }],
    }


def trial_schema() -> dict:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://wireup.dev/contracts/trial.schema.json",
        "title": "Trial",
        "description": "A reproducible experiment: a goal, a sweep space, a seed, and a verdict "
                       "computed only from measured telemetry.",
        "type": "object", "additionalProperties": False,
        "required": ["id", "project_id", "goal", "parameters", "seed", "runs", "verdict", "summary"],
        "properties": {
            "id": {"type": "string", "minLength": 1, "maxLength": 128},
            "project_id": {"type": "string"},
            "goal": {
                "type": "object", "required": ["metric", "direction"], "additionalProperties": False,
                "properties": {
                    "metric": {"type": "string"},
                    "target": {"type": "number"},
                    "direction": {"enum": ["min", "max", "target"]},
                    "tolerance": {"type": "number", "minimum": 0},
                    "window": {"type": ["array", "null"], "items": {"type": "number"},
                               "minItems": 2, "maxItems": 2},
                },
            },
            "parameters": {
                "type": "array",
                "items": {"type": "object", "required": ["node", "property", "values"],
                          "additionalProperties": False,
                          "properties": {"node": {"type": "string"},
                                         "property": {"type": "string"},
                                         "values": {"type": "array", "items": {"type": "number"},
                                                    "minItems": 1}}},
            },
            "environment_overrides": {"type": "object"},
            "seed": {"type": "integer",
                     "description": "Explicit. Same graph + same seed = same result."},
            "runs": {
                "type": "array",
                "items": {"type": "object", "required": ["index", "seed", "verdict"],
                          "additionalProperties": False,
                          "properties": {
                              "index": {"type": "integer", "minimum": 0},
                              "seed": {"type": "integer"},
                              "parameters": {"type": "object"},
                              "telemetry_ref": {"type": ["string", "null"]},
                              "metrics": {"type": "object",
                                          "additionalProperties": {"type": ["number", "null"]}},
                              "verdict": {"enum": ["pass", "fail", "error"]},
                              "error": {"type": ["object", "null"]},
                          }},
            },
            "verdict": {"enum": ["pass", "fail", "error"],
                        "description": "Computed from the goal alone. Never written by a caller."},
            "summary": {"type": "object"},
        },
    }


def capability_schema() -> dict:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://wireup.dev/contracts/capability.schema.json",
        "title": "Declared platform capability",
        "description": "What the platform can actually do. Generated from solver registration and "
                       "test results; never hand-maintained. The 'unsupported' array is the most "
                       "important part of the platform: it is what stops an agent claiming a "
                       "simulation that does not exist.",
        "type": "object", "additionalProperties": False,
        "required": ["generated_at", "generator_version", "generator_status", "kinds",
                     "unsupported", "limits"],
        "properties": {
            "generated_at": {"type": "string",
                             "description": "Derived from the manifest hash, not the wall clock, "
                                            "so regeneration is byte-identical."},
            "generator_version": {"type": "integer"},
            "generator_status": {"enum": ["stub", "generated"],
                                 "description": "'stub' means no solver has registered yet. "
                                                "Nothing may treat a stub as truth."},
            "kinds": {
                "type": "array",
                "items": {"type": "object", "required": ["id", "simulated"],
                          "additionalProperties": False,
                          "properties": {
                              "id": {"type": "string"}, "exists": {"type": "boolean"},
                              "solver": {"type": ["string", "null"]},
                              "simulated": {"type": "boolean"},
                              "confidence": {"enum": ["verified", "partial", "experimental", "unknown"]},
                              "exercised_by_cases": {"type": "array", "items": {"type": "string"}},
                          }},
            },
            "telemetry_channels": {"type": "array", "items": {"type": "string"}},
            "unsupported": {
                "type": "array",
                "items": {"type": "object",
                          "required": ["feature", "reason", "required_to_support"],
                          "additionalProperties": False,
                          "properties": {"kind": {"type": ["string", "null"]},
                                         "feature": {"type": "string"},
                                         "reason": {"type": "string"},
                                         "required_to_support": {"type": "string"}}},
            },
            "environments": {"type": "array", "items": {"type": "string"}},
            "limits": {"type": "object", "additionalProperties": {"type": "integer", "minimum": 0}},
        },
    }


def derivations() -> dict:
    return {
        "version": 1,
        "generated_by": GENERATED_BY,
        "description": "How each derived channel is computed. A telemetry sample with "
                       "quality='derived' MUST name an entry here, or the recorder rejects it. "
                       "This is invariant I5 expressed as data.",
        "channels": [
            {"channel": "pin.duty_cycle", "formula": "count(high_edges) / count(edges)",
             "inputs": ["pin.edge"], "solver": "mcu", "confidence": "exact"},
            {"channel": "pin.avg_voltage", "formula": "duty_cycle * vcc",
             "inputs": ["pin.duty_cycle", "power.vcc"], "solver": "circuit", "confidence": "approximate",
             "note": "Assumes a linear load. Not valid for a strongly nonlinear load."},
            {"channel": "motor.angular_velocity", "formula": "60 * rpm / (2 * pi)",
             "inputs": ["motor.rpm"], "solver": "mechanics", "confidence": "exact"},
            {"channel": "heading.unit_vector",
             "formula": "[cos(heading), sin(heading)]",
             "inputs": ["imu.heading_rad"], "solver": "mechanics", "confidence": "exact"},
            {"channel": "runtime.simulated_time", "formula": "cycles / clock_hz",
             "inputs": ["mcu.cycles", "mcu.clock_hz"], "solver": "mcu", "confidence": "exact"},
            {"channel": "pin.level",
             "formula": "arithmetic mean of the samples in a telemetry query bucket",
             "inputs": ["pin.level"], "solver": "telemetry", "confidence": "exact"},
            {"channel": "mcu.cycles",
             "formula": "arithmetic mean of the samples in a telemetry query bucket",
             "inputs": ["mcu.cycles"], "solver": "telemetry", "confidence": "exact"},
            {"channel": "mcu.clock_hz",
             "formula": "arithmetic mean of the samples in a telemetry query bucket",
             "inputs": ["mcu.clock_hz"], "solver": "telemetry", "confidence": "exact"},
            {"channel": "runtime.simulated_time",
             "formula": "arithmetic mean of the samples in a telemetry query bucket",
             "inputs": ["runtime.simulated_time"], "solver": "telemetry", "confidence": "exact"},
            {"channel": "analog.node_voltage",
             "formula": "arithmetic mean of the samples in a telemetry query bucket",
             "inputs": ["analog.node_voltage"], "solver": "telemetry", "confidence": "exact"},
            {"channel": "analog.branch_current",
             "formula": "arithmetic mean of the samples in a telemetry query bucket",
             "inputs": ["analog.branch_current"], "solver": "telemetry", "confidence": "exact"},
            # ---- physics (v11) -------------------------------------------------
            # Every quantity below is computed from a declared coefficient rather than
            # observed. Listing them here is what lets the recorder accept a
            # quality:"derived" sample at all, and it is the list a reviewer reads to
            # find out what the simulation is actually assuming.
            {"channel": "body.speed_mps", "formula": "sqrt(vx^2 + vy^2 + vz^2)",
             "inputs": ["body.velocity.x", "body.velocity.y", "body.velocity.z"],
             "solver": "mechanics", "confidence": "exact",
             "note": "Euclidean norm of the integrated body velocity."},
            {"channel": "hull.displaced_m3",
             "formula": "sum(volume_i for sample points with world_z < surface_z)",
             "inputs": ["body.position.z", "env.water_density_kg_m3"],
             "solver": "mechanics", "confidence": "approximate",
             "note": "Quantised by the declared sample grid. Increase `samples` to converge."},
            {"channel": "hull.drag_force_n",
             "formula": "0.5 * rho * Cd_i * A_i * |v_i| * v_i per body axis",
             "inputs": ["body.velocity.x", "env.water_density_kg_m3"],
             "solver": "mechanics", "confidence": "approximate",
             "note": "Cd and reference area are DECLARED per hull, never measured. A declared "
                      "planing multiplier multiplies the result above the Froude threshold."},
            {"channel": "hull.froude", "formula": "v_surge / sqrt(g * L)",
             "inputs": ["hull.speed_surge_mps"], "solver": "mechanics", "confidence": "approximate",
             "note": "L is the declared waterline length. The drag multiplier is a declared STEP at "
                      "this number, not a smooth blend."},
            {"channel": "hull.gm_m", "formula": "KB + BM - KG with BM = I_waterplane / V_displaced",
             "inputs": ["hull.displaced_m3"], "solver": "mechanics", "confidence": "approximate",
             "note": "Computed from the declared rectangular waterplane, once, at build time. A "
                      "negative GM is reported as a warning and never suppressed."},
            {"channel": "hull.added_mass_ratio", "formula": "declared Ca on the surge axis",
             "inputs": [], "solver": "mechanics", "confidence": "approximate",
             "note": "A declared coefficient, not a fitted one. Linear added mass is credible below "
                      "Ca = 1.0 only."},
            {"channel": "thruster.thrust_n",
             "formula": "gain * shaped((signal - deadband) / (1 - deadband)), clamped at saturation",
             "inputs": ["actuator.signal"], "solver": "mechanics", "confidence": "exact",
             "note": "The declared transfer function. Exact given the declared curve, gain and "
                      "deadband; the physical truth of those declarations is a separate question."},
            {"channel": "actuator.torque_nm", "formula": "same transfer function, torque units",
             "inputs": ["actuator.signal"], "solver": "mechanics", "confidence": "exact",
             "note": "Bidirectional actuators centre the signal at 0.5."},
            {"channel": "rotor.thrust_n", "formula": "Ct * rho_air * A_blade * v_tip^2, v_tip = omega * R",
             "inputs": ["rotor.rpm", "env.air_density_kg_m3"], "solver": "mechanics",
             "confidence": "approximate",
             "note": "Free-air disc model. Ct and blade area are declared. Ground effect and "
                      "rotor-rotor interaction are declared unavailable."},
            {"channel": "airframe.drag_n",
             "formula": "|0.5 * rho_air * Cd * A * |v - v_wind| * (v - v_wind)|",
             "inputs": ["body.velocity.x", "env.wind_speed_mps"], "solver": "mechanics",
             "confidence": "approximate",
             "note": "Cd and reference area are declared. The force the airframe must fight to "
                      "hold station in a wind; this model has no attitude or position controller, "
                      "so it is NOT a prediction of how much extra hover thrust a real drone needs."},
            {"channel": "env.air_density_kg_m3", "formula": "p / (R * T) from the ISA troposphere",
             "inputs": ["env.air_temperature_c"], "solver": "environment", "confidence": "exact",
             "note": "Exact within the ISA troposphere by definition. It is the reference the "
                      "recorded readings are compared against, not the real atmosphere."},
            # ---- software (v12) ------------------------------------------------
            {"channel": "web.load_ms", "formula": "elapsed wall clock of the loopback fetch",
             "inputs": [], "solver": "software", "confidence": "exact",
             "note": "A local loopback fetch. NOT a real page-load metric: no browser renders the "
                      "page, so this measures the supervisor, not a user's experience."},
            {"channel": "web.http_status", "formula": "HTTP status of the loopback fetch",
             "inputs": [], "solver": "software", "confidence": "exact"},
            {"channel": "web.document_bytes", "formula": "byte length of the served document",
             "inputs": [], "solver": "software", "confidence": "exact"},
            {"channel": "script.probe_value", "formula": "the declared DOM operation's result",
             "inputs": [], "solver": "software", "confidence": "exact",
             "note": "A named operation over the served markup (exists, count, text, attr, value, "
                      "has_class, title). Client-side JavaScript does not run, so this is the "
                      "document, never a rendered DOM."},
        ],
    }


def port_types() -> dict:
    types = [
        ("power.dc", "A DC supply rail.", ["V", "A"], ["power.dc"], "value", ["electronics", "hybrid"]),
        ("power.gnd", "Ground reference.", [], ["power.gnd", "power.dc"], "value", ["electronics", "hybrid"]),
        ("signal.electrical", "An electrical node at a potential.", ["V"],
         ["signal.electrical", "signal.digital", "signal.pwm", "signal.analog"], "value", ["electronics", "hybrid"]),
        ("signal.digital", "A logic-level binary signal.", [],
         ["signal.digital", "signal.electrical"], "value", ["electronics", "hybrid"]),
        ("signal.pwm", "A pulse-width modulated output.", ["%"],
         ["signal.pwm", "signal.digital"], "value", ["electronics", "hybrid", "mechanics"]),
        ("signal.analog", "A continuous analogue signal.", ["V"],
         ["signal.analog", "signal.electrical"], "value", ["electronics", "hybrid", "mechanics"]),
        ("signal.serial", "A UART serial link.", ["baud"], ["signal.serial"], "data", ["electronics", "hybrid"]),
        ("signal.i2c", "An I2C bus. Two buses may share one net.", ["Hz"], ["signal.i2c"], "data", ["electronics", "hybrid"]),
        ("signal.spi", "An SPI bus.", ["Hz"], ["signal.spi"], "data", ["electronics", "hybrid"]),
        ("mech.force", "A linear force on a rigid body.", ["N"], ["mech.force"], "force", ["mechanics", "hybrid"]),
        ("mech.torque", "A torque about an axis.", ["N*m"], ["mech.torque"], "force", ["mechanics", "hybrid"]),
        ("mech.linear", "A linear displacement or velocity.", ["m", "m/s"], ["mech.linear"], "value", ["mechanics", "hybrid"]),
        ("mech.angular", "An angular displacement or rate.", ["rad", "rad/s"], ["mech.angular"], "value", ["mechanics", "hybrid"]),
        ("fluid.pressure", "A fluid pressure port.", ["Pa"], ["fluid.pressure"], "value", ["mechanics", "environment"]),
        ("data.file", "A file produced or consumed by a software node.", [], ["data.file"], "data", ["software"]),
        ("data.stream", "A stream of values.", [], ["data.stream"], "data", ["software", "hybrid"]),
        ("net.http", "An HTTP request or response.", [], ["net.http"], "packet", ["software"]),
        ("net.tcp", "A TCP connection.", [], ["net.tcp"], "packet", ["software"]),
        ("env.reference", "A reference to a shared environment source.", [], ["env.reference"], "value",
         ["mechanics", "environment", "hybrid"]),
    ]
    return {
        "version": 1,
        "generated_by": GENERATED_BY,
        "description": "The port and edge type system. Two ports may connect only when one type "
                       "appears in the other's compatible_with list. Any other connection is a "
                       "typed error naming both ports - never a silent drop (invariant I7).",
        "port_types": [
            {"id": i, "description": d, "units": u, "compatible_with": c, "carries": k, "domains": dm}
            for i, d, u, c, k, dm in types
        ],
    }


def capability_stub(kinds: list) -> dict:
    return {
        "generated_at": "stub",
        "generator_version": GENERATOR_VERSION,
        "generator_status": "stub",
        "kinds": [{"id": k["id"], "exists": True, "solver": k["solver"], "simulated": k["simulated"],
                   "confidence": "unknown", "exercised_by_cases": []} for k in kinds],
        "telemetry_channels": [],
        "unsupported": [
            {"kind": None,
             "feature": "Universal graph store, tool bus, MCP surface, headless runtime, "
                        "orchestrator, 3D room, mechanics solver, software sandbox",
             "reason": "Not implemented. This file is a stub generated before any solver registered.",
             "required_to_support": "Phases v02-v12 of prompts/."},
            {"kind": "board.esp32-devkit-v1", "feature": "ESP32 DevKit V1 browser simulation",
             "reason": "No configured native runtime.",
             "required_to_support": "A working ESP32 QEMU lane; phase v07."},
            {"kind": "board.esp32-c3", "feature": "ESP32-C3 native runtime",
             "reason": "Vendor RiscVCore adapter fails at PC 0x514c26 after 2,666,667 cycles.",
             "required_to_support": "Fix the vendor CPU adapter; phase v07."},
            {"kind": "board.nano-rp2040-connect",
             "feature": "Pico W CYW43 radio and onboard LED",
             "reason": "Unimplemented in the browser CPU emulator.",
             "required_to_support": "CYW43 emulation. External GPIO and UART0 work today."},
            {"kind": None,
             "feature": "AC sweep, noise analysis and temperature sweep",
             "reason": "Only DC bias and transient are implemented.",
             "required_to_support": "ngspice AC/noise/temperature wiring; phase v06."},
            {"kind": None, "feature": "Compiler isolation for untrusted firmware",
             "reason": "Native compilation runs in-process.",
             "required_to_support": "Sandboxed runtime worker; phase v07."},
            {"kind": None, "feature": "Per-user authentication and project authorization",
             "reason": "Shared-token reference auth only.",
             "required_to_support": "Identity and per-project ownership; required before public deployment."},
        ],
        "environments": [],
        "limits": {"max_nodes": 512, "max_trial_runs": 64, "max_sim_seconds": 300,
                   "max_payload_bytes": 200000, "max_tool_calls_per_run": 400,
                   "max_iterations": 12, "max_model_calls": 60},
    }
