<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Canonical SPICE catalog schema (version 1)

Backend `ComponentCatalog` adds these schematic-only definitions even when vendor metadata is absent. All four board definitions and compiler/runtime interfaces are unchanged. These entries provide validated project data, not simulation results. The browser ngspice adapter must perform actual solves and report unsupported features honestly.

**Adapter coordination:** canonical type is component `type` / catalog `id`. Use the exact source IDs below; the frontend draft's `voltage-source`, `sine-source`, etc. are not backend aliases. Source pins are literal `+` and `-`; ground is `GND`. Use source current sign from `+` toward `-`. Source descriptors carry `spice_model`, `schema_version:1`, `schematic_only:true`, and no custom-element tag. Do not infer a runnable engine from catalog presence.

| Canonical type | Properties and defaults |
| --- | --- |
| `source-dc-voltage` | `voltage:5` |
| `source-dc-current` | `current:0.001` |
| `source-sine-voltage` | `offset:0, amplitude:5, frequency:1000, delay:0, damping:0, phase:0` |
| `source-pulse-voltage` | `low:0, high:5, delay:0, rise:0.000001, fall:0.000001, width:0.0005, period:0.001` |
| `source-pwl-voltage` | `points:[[0,0],[0.001,5],[0.002,0]]` |
| `source-ac-voltage` | `voltage:0, magnitude:1, phase:0` |
| `ground` | No properties; pin `GND` maps to SPICE node 0. |

Source scalar values are **finite JSON numbers only** (booleans and engineering strings rejected). Voltages, offset, pulse low/high, and current: -1e6 to +1e6 V/A. Amplitude/magnitude: 0 to 1e6 V. Frequency: 1e-6 to 1e6 Hz. Delay: 0 to 1e6 s. Rise/fall/width/period: 1e-12 to 1e6 s. Damping: 0 to 1e6 per second. Phase: -360 to +360 degrees. Catalog numeric descriptors expose min/max/unit. Pulse rise + width + fall must not exceed period, including after a partial edit merges with persisted values.

PWL `points` is an array of 2 to 256 arrays `[time_seconds, voltage_volts]`; both elements are finite JSON numbers. Times are 0 to 1e6 and strictly increasing (no duplicate timestamps); voltages are -1e6 to +1e6. No strings, expressions, objects, or raw PWL/netlist snippets. Array descriptor type is `number-pairs`, with bounds and item limits exposed in metadata. The UI must provide an array editor rather than a scalar text editor.

AC source `voltage` is the DC operating-point bias; `magnitude` and `phase` are small-signal AC parameters. Adding the source does not implement AC frequency sweeps; the frontend's DC/transient solve remains limited to its supported analyses.

## Passive metadata

Generated vendor canonical IDs are `resistor`, `capacitor`, and `inductor`; names such as `velxio-capacitor-electrolytic` are tags, not replacement IDs. Existing vendor names/thumbnails/tags remain. `capacitor` and `inductor` now both have connectable pins `1`,`2`. This task does not claim support for every vendor preset or electrolytic variant.

Each standard passive accepts exactly `value`, **a string**, preserving real vendor metadata and defaults: resistor `"1000"` ohms, capacitor `"1u"` farads, inductor `"1m"` henries. A strict positive numeric token may include decimal/scientific notation and one SPICE suffix: `T`, `G`, `Meg`, `k`, `m`, `u`, `n`, `p`, `f` (case-insensitive; M means milli, use Meg for mega). Examples: `"220"`, `"4.7k"`, `"1e3"`, `"10u"`, `"2.2m"`. Maximum 48 characters. No whitespace, units appended, signs before the mantissa, braces, expressions, newlines, commands, or semicolons. Effective resistance must be 1e-6 to 1e12 ohms; capacitance/inductance must be 1e-15 to 1e6 F/H. Numeric JSON passive values are rejected because the canonical vendor property is a string. Descriptors expose `type:"string"`, `format:"spice-value"`, `pattern`, and effective numeric min/max.

## Mutation contract

Use unchanged add_component / modify_component / connect_wire commands. Source defaultValues persist on add; partial edits merge and validate against prior properties. Unknown property names, wrong pin names, invalid numbers/PWL shapes, and unsafe passive strings return HTTP 400 without a new revision/history entry or partial persistence. Existing expected_revision and undo semantics remain. The adapter must parse strict values to numbers and generate its own controlled element/node identifiers; never paste component IDs, labels, or arbitrary property text into a netlist. This backend supplies no netlist-text field and no fake measurements.

Verification: dedicated `backend/tests/test_spice_catalog.py` plus existing non-real-compiler hardware regressions passed **257 tests** (four real compiler tests deliberately deselected; compiler/runtime code was not changed). Coverage includes every source numeric field's type/bounds, oversized integers/nonfinite values, PWL shape/order/limits, pulse partial-edit consistency, all source/ground/passive add/connect behavior, unsafe passive strings, atomic rejection, persistence/undo, vendor metadata retention, and all board catalog entries. `py_compile backend/hardware.py` passed.
