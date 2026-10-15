"""contracts/kinds.json: every buildable thing, and whether it is simulated.

The `simulated` flag is load-bearing. It is set ONLY where an executable Playwright spec
exists that exercises the part, and every such claim records the spec path in `evidence`
so it can be traced. Phase v06 upgrades this from "a spec exists" to "the spec passes"
once CI can run.

Split out of scripts/gen-contracts.py when the god-file guard flagged it.
"""

import json
import re

from contracts.common import (
    AVAILABILITY, BOARDS_PY, GENERATED_BY, PINS_JSON, ROOT, Unsupported, read_literal_list,
)
from contracts.domain_kinds import domain_kinds

GROUP_RULES = [
    ("board",     r"^(arduino-|esp32-|nano-rp2040|franzininho)"),
    ("logic",     r"^(bjt-|mosfet-|ic-74hc|logic-gate|opamp-|flip-flop|diode|zener|reg-|opto-|a4988|motor-driver)"),
    ("passive",   r"^(resistor|capacitor|cap-|inductor|ind-|battery-|junction|breadboard|power-supply)"),
    ("source",    r"^(signal-generator)"),
    ("input",     r"^(pushbutton|slide-switch|dip-switch|tilt-switch|analog-joystick|rotary-dialer|membrane-keypad)"),
    ("input",     r"^(potentiometer|slide-potentiometer)"),
    ("storage",   r"^(microsd-card)"),
    ("input",     r"^(ir-remote|ir-receiver|remote)"),
    ("output",    r"^(led|rgb-led|neopixel|7segment|lcd|ssd1306|epaper-|ili9341|buzzer)"),
    ("sensor",    r"^(ntc-temperature|photoresistor|pir-|bmp280|dht22|mpu6050|ds1307|ds3231|flame-|gas-|hc-sr04|hx711|gps-|photodiode|big-sound|small-sound|heart-beat|servo$|ky-040)"),
    ("electromech", r"^(stepper-motor|biaxial-stepper|relay$|motor|ks2e-)"),
]

# Parts with EVIDENCED modelled behaviour, cited to the executable spec that exercises them.
#
# Why this replaces the prose in docs/COMPONENT_SIMULATION_AVAILABILITY.md: that document's
# tables are a historical inventory that lists 70 of the 73 parts below as unsupported, while
# its own header and the test suite say otherwise. A passing spec is evidence; a stale table is
# not. `evidence` is recorded on every kind so any claim can be traced to a test, and phase v06
# upgrades this from "a spec exists" to "the spec passes" once CI can actually run.
#
# scope: `uno` = the browser runtime lane (Uno/Nano/Mega). `spice` = the ngspice path.
EVIDENCE = {
    "uno": {
        "tests/uno-peripherals.spec.ts": ["led", "pushbutton", "pushbutton-6mm", "buzzer", "servo",
                                          "led-bar-graph", "potentiometer", "slide-potentiometer"],
        "tests/uno-lifecycle.spec.ts": ["led", "pushbutton", "buzzer"],
        "tests/avr-peripherals.spec.ts": ["led", "pushbutton"],
        "tests/analog-sensors.spec.ts": ["ntc-temperature-sensor", "photoresistor-sensor",
                                         "pir-motion-sensor"],
        "tests/more-sensors.spec.ts": ["flame-sensor", "gas-sensor", "big-sound-sensor",
                                       "small-sound-sensor", "heart-beat-sensor", "photodiode",
                                       "hc-sr04", "hx711"],
        "tests/i2c-sensors.spec.ts": ["bmp280", "mpu6050", "ds1307", "ds3231", "hx711"],
        "tests/dht-runtime.spec.ts": ["dht22"],
        "tests/bmp-runtime.spec.ts": ["bmp280"],
        "tests/rgb-runtime.spec.ts": ["rgb-led"],
        "tests/neopixel-runtime.spec.ts": ["neopixel", "neopixel-matrix"],
        "tests/led-bar-runtime.spec.ts": ["led-bar-graph", "led-ring"],
        "tests/dip-switch-runtime.spec.ts": ["dip-switch-8"],
        "tests/joystick-runtime.spec.ts": ["analog-joystick"],
        "tests/keypad-runtime.spec.ts": ["membrane-keypad"],
        "tests/rotary-runtime.spec.ts": ["rotary-dialer"],
        "tests/slide-switch-runtime.spec.ts": ["slide-switch", "tilt-switch"],
        "tests/lcd-runtime.spec.ts": ["lcd1602", "lcd2004"],
        "tests/oled-runtime.spec.ts": ["ssd1306", "ssd1306-i2c-4pin"],
        "tests/oled-spi-runtime.spec.ts": ["ssd1306"],
        "tests/ili9341-runtime.spec.ts": ["ili9341"],
    },
    "spice": {
        "tests/spice.spec.ts": ["resistor", "capacitor", "inductor", "diode",
                                "voltage-source", "current-source"],
        "tests/analog-passive-variants.spec.ts": [
            "resistor-1k", "resistor-2k2", "resistor-4k7", "resistor-10k", "resistor-22k",
            "resistor-47k", "resistor-100k", "resistor-220", "resistor-330", "resistor-470",
            "resistor-1m", "capacitor-electrolytic", "cap-100n", "cap-100p", "cap-10n",
            "cap-10p", "cap-1n", "cap-1u", "cap-22p", "cap-elec-1000u", "cap-elec-100u",
            "cap-elec-10u", "cap-elec-1u", "cap-elec-470u", "cap-elec-47u", "ind-100u",
            "ind-10m", "ind-1m", "diode-1n4007", "diode-1n4148", "zener-1n4733",
            "battery-9v", "battery-aa", "battery-coin-cell", "power-supply"],
    },
}

# Flattened lookup: part -> (scope, [evidence spec paths])
MODELLED: dict = {}
for _scope, _by_spec in EVIDENCE.items():
    for _spec, _parts in _by_spec.items():
        for _part in _parts:
            _prev = MODELLED.get(_part)
            if _prev is None or (_scope == "uno" and _prev[0] != "uno"):
                MODELLED[_part] = (_scope, sorted({*( _prev[1] if _prev else []), _spec}))
            else:
                MODELLED[_part] = (_prev[0], sorted({*_prev[1], _spec}))

# Boards with genuine browser CPU emulation, each cited to the spec that proves it.
# RELEASE_STATUS.md records: Uno, Nano, Mega and Pico run; Pico W runs external GPIO and
# UART0 only (no CYW43 radio, no onboard LED); every ESP32 and Pi target has no runtime.
BROWSER_BOARDS = {
    "arduino-uno": "tests/uno-lifecycle.spec.ts",
    "arduino-nano": "tests/uno-peripherals.spec.ts",
    "arduino-mega": "tests/avr-peripherals.spec.ts",
    "pi-pico": "tests/pico-runtime.spec.ts",
    "pi-pico-w": "tests/pico-runtime.spec.ts",
    # Upstream alias for the same RP2040 board, present in the component catalogue.
    "nano-rp2040-connect": "tests/pico-runtime.spec.ts",
}
# The Pico W's real limits, stated rather than implied.
PARTIAL_BOARDS = {
    "pi-pico-w": "External GPIO and UART0 only. The CYW43 radio and the onboard LED are "
                 "unimplemented; firmware using WiFi, Bluetooth, cyw43 or LED_BUILTIN is "
                 "rejected rather than approximated.",
}

PORT_ROLES = [
    (r"^(a|anode|\+)$", "a", "signal.electrical"),
    (r"^(k|cathode|\-)$", "k", "signal.electrical"),
    (r"^(vcc|vin|vdd|5v|3v3)$", "vcc", "power.dc"),
    (r"^(gnd|ground|0)$", "gnd", "power.gnd"),
    (r"^(sda|scl)$", "i2c", "signal.i2c"),
    (r"^(mosi|miso|sck|cs|ss)$", "spi", "signal.spi"),
    (r"^(tx|rx|rxd|txd)$", "uart", "signal.serial"),
    (r"^(a\d+|adc\d*)$", "adc", "signal.analog"),
    (r"^d\d+$", "io", "signal.digital"),
    (r"^(s\d|out|in|sw|trig|echo|en|led|sig|v|dout|din|rst)$", "io", "signal.digital"),
]


def pin_port(name: str):
    clean = str(name).strip()
    for pattern, role, ptype in PORT_ROLES:
        if re.match(pattern, clean, re.I):
            return role, ptype
    return None, "signal.electrical"


def read_boards_module(path):
    """Import backend/hardware/boards.py and return its board catalogue and pin layouts.

    That module imports only the standard library (json, math, re, pathlib), so importing
    it is safe, and it is what the backend itself already does.

    An earlier version read these with the AST evaluator. It failed silently: it returned 4
    of the 12 BOARDS entries, so 8 boards were missing from contracts/kinds.json with no
    error anywhere. A parser that quietly returns less than the source is worse than no
    parser. Reading PIN_LAYOUTS the same way also removed three hand-rolled comprehension
    parsers that each broke on a different pin-list form.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location("_wireup_boards", str(path))
    if spec is None or spec.loader is None:
        raise Unsupported(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    boards = list(getattr(module, "BOARDS", []) or [])
    layouts = dict(getattr(module, "PIN_LAYOUTS", {}) or {})
    if len(boards) < 6:
        raise Unsupported(f"{path.name} yielded only {len(boards)} boards; expected at least 6. "
                          f"A partial catalogue would silently drop boards from the contract.")
    return boards, layouts


def build_kinds() -> dict:
    pins_doc = json.loads(PINS_JSON.read_text(encoding="utf-8"))
    components = pins_doc["components"]
    boards, pin_layouts = read_boards_module(BOARDS_PY)

    availability = AVAILABILITY.read_text(encoding="utf-8", errors="replace")
    documented = {m.group(1) for m in
                  re.finditer(r"^\|[^|]*\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|", availability, re.M)}

    kinds, unresolved = [], []

    # Provenance check: every cited spec must actually exist. A typo would otherwise create a
    # capability claim backed by nothing.
    for _scope, _by_spec in EVIDENCE.items():
        for spec_path in _by_spec:
            if not (ROOT / spec_path).exists():
                raise Unsupported(f"evidence spec does not exist: {spec_path}")

    # A board can appear BOTH in the component catalogue and in BOARDS. Emit it once, from
    # BOARDS, which carries the runtime metadata; the catalogue copy has no simulation claim.
    board_ids = {b["id"] for b in boards}

    for cid in sorted(components):
        if cid in board_ids:
            continue
        entry = components[cid]
        group = None
        for g, pattern in GROUP_RULES:
            if re.match(pattern, cid):
                group = g
                break
        ports = []
        seen = set()
        for p in entry.get("pins", []):
            n = str(p["name"])
            if n in seen:
                continue
            seen.add(n)
            role, ptype = pin_port(n)
            ports.append({"name": n, "type": ptype, "direction": "inout", "role": role})
        if len(ports) == 2 and ports[0]["role"] == "a" and ports[1]["role"] == "k":
            ports[0]["direction"] = "in"
            ports[1]["direction"] = "out"

        if group is None:
            unresolved.append(cid)
            kinds.append({
                "id": f"part.unresolved_{cid.split('-')[0]}",
                "label": cid, "group": "part", "legacy_type": cid,
                "tagName": entry.get("tagName"), "derived_by": None,
                "ports": ports, "properties": {}, "defaults": entry.get("defaultValues") or {},
                "solver": None, "simulated": False, "scope": "none",
                "notes": f"Catalogue entry '{cid}' with no derivable group. Ports come from pin "
                         f"names only. Behaviour is unknown and must not be assumed.",
            })
            continue

        ev = MODELLED.get(cid)
        scope = ev[0] if ev else None
        kinds.append({
            "id": f"{group}.{cid}",
            "label": cid, "group": group, "legacy_type": cid,
            "tagName": entry.get("tagName"), "derived_by": "GROUP_RULES",
            "ports": ports,
            "properties": entry.get("properties") or {},
            "defaults": entry.get("defaultValues") or {},
            "solver": ("circuit" if scope == "spice" else ("mcu" if scope == "uno" else None)),
            "simulated": scope is not None,
            "scope": scope or "none",
            "evidence": ev[1] if ev else [],
            "notes": kind_note(group, cid, scope, entry, cid in documented),
        })

    # Board pin layouts give every board real ports. A board with no ports would be
    # unwireable, so the graph could not represent a circuit at all.

    for b in boards:
        ok = b.get("id") in BROWSER_BOARDS
        pins = pin_layouts.get(b.get("id")) or []
        seen = set()
        ports = []
        for name in pins:
            if name in seen:
                continue
            seen.add(name)
            role, ptype = pin_port(name)
            ports.append({"name": name, "type": ptype, "direction": "inout", "role": role})
        kinds.append({
            "id": f"board.{b['id']}",
            "label": b.get("name", b["id"]), "group": "board", "legacy_type": b["id"],
            "tagName": None, "derived_by": "backend/hardware/boards.py BOARDS + PIN_LAYOUTS",
            "ports": ports,
            "properties": {}, "defaults": {"fqbn": b.get("fqbn")},
            "solver": "mcu" if ok else None,
            "simulated": ok,
            "scope": "browser" if ok else "none",
            "evidence": [BROWSER_BOARDS[b["id"]]] if ok else [],
            "notes": (f"{len(ports)} pins from PIN_LAYOUTS. Genuine CPU emulation in the browser "
                      f"runtime; requires a connected browser. Headless execution arrives in v07."
                      if ok else (b.get("unavailable_reason") or "No configured runtime.")),
        })

    kinds.extend(domain_kinds())
    kinds.sort(key=lambda k: k["id"])
    return {
        "version": 1,
        "generated_by": GENERATED_BY,
        "description": "Every buildable thing and whether it is simulated. `simulated` and "
                       "`scope` are load-bearing: they are what stops an AI agent claiming a "
                       "part was tested when it was only placed. Generated, never hand-edited.",
        "generated_from": {
            "backend/catalog/component-pins.json": {
                "components": len(components), "counts": pins_doc.get("counts")},
            "backend/hardware/boards.py": {"boards": len(boards)},
            "docs/COMPONENT_SIMULATION_AVAILABILITY.md": {"documented": len(documented)},
        },
        "unresolved_count": len(unresolved),
        "unresolved": unresolved,
        "kinds": kinds,
    }


def kind_note(group, cid, scope, entry, documented) -> str:
    if entry.get("status") not in (None, "verified"):
        return (f"Catalogue status '{entry['status']}'. Pins derived from the catalogue; "
                f"behaviour unverified.")
    if scope is None and documented:
        return (f"Placement-only. '{cid}' is listed under 'No implemented normal "
                f"board/peripheral simulation' in docs/COMPONENT_SIMULATION_AVAILABILITY.md. "
                f"It can be placed and wired but produces no telemetry.")
    if scope is None:
        return (f"No modelled behaviour is evidenced for '{cid}' in this build. It can be placed "
                f"and wired but produces no telemetry. Requires an explicit solver "
                f"implementation before it may be claimed as simulated.")
    if scope == "uno":
        return ("Modelled by the browser runtime, evidenced on the Uno lane only "
                "(Uno/Nano/Mega). Other boards are unverified.")
    return "Solved by ngspice: DC bias and transient only. No AC sweep, noise or temperature sweep."
