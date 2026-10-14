"""The component catalogue: search, pin validation and SPICE-backed entries.

Split out of the former single backend/hardware.py module during phase v01.
"""

import copy
import json
import re
from pathlib import Path


from backend.hardware.boards import (
    BOARDS,
    BOARD_ALIASES,
    BOARD_CONFIG,
    COMPONENT_PINS,
    EXPLICIT_PIN_LAYOUTS,
    PIN_ALIASES,
    PIN_LAYOUTS,
    ROOT,
)
from backend.hardware.util import (
    SPICE_PASSIVE_DEFAULTS,
    SPICE_VALUE_PATTERN,
    fail,
    spice_catalog_entries,
)


class ComponentCatalog:
    def __init__(self, path=None):
        path = Path(path) if path else ROOT / 'vendor/velxio/frontend/public/components-metadata.json'
        self.origin = str(path) if path.is_file() else 'builtin-fallback'
        if path.is_file():
            items = json.loads(path.read_text(encoding='utf-8')).get('components', [])
        else:
            items = [{'id': key, 'name': key.replace('-', ' ').title(), 'category': 'boards' if key in BOARD_CONFIG else 'other'} for key in PIN_LAYOUTS]
        present = {item['id'] for item in items}
        items.extend({**board, 'category': 'boards', 'properties': [], 'defaultValues': {}}
                     for board in BOARDS if board['id'] not in present)
        source_entries = {item['id']: item for item in spice_catalog_entries()}
        for item in items:
            if item['id'] in source_entries:
                item.update(copy.deepcopy(source_entries.pop(item['id'])))
            if item['id'] in SPICE_PASSIVE_DEFAULTS:
                default = item.get('defaultValues', {}).get('value', SPICE_PASSIVE_DEFAULTS[item['id']])
                bounds = (1e-6, 1e12) if item['id'] == 'resistor' else (1e-15, 1e6)
                item.update({'properties': [{'name': 'value', 'type': 'string', 'format': 'spice-value',
                                              'pattern': SPICE_VALUE_PATTERN, 'min': bounds[0], 'max': bounds[1],
                                              'defaultValue': default, 'control': 'text'}],
                             'defaultValues': {'value': default}, 'spice_model': item['id'], 'schema_version': 1,
                             'pinCount': 2})
        items.extend(source_entries.values())
        present = {item['id'] for item in items}
        for kind, default in SPICE_PASSIVE_DEFAULTS.items():
            if kind not in present:
                minimum, maximum = (1e-6, 1e12) if kind == 'resistor' else (1e-15, 1e6)
                items.append({'id': kind, 'name': kind.title(), 'tagName': 'wokwi-' + kind,
                              'category': 'passive', 'pinCount': 2, 'spice_model': kind, 'schema_version': 1,
                              'defaultValues': {'value': default},
                              'properties': [{'name': 'value', 'type': 'string', 'format': 'spice-value',
                                              'pattern': SPICE_VALUE_PATTERN, 'min': minimum, 'max': maximum,
                                              'defaultValue': default, 'control': 'text'}]})
        self.components = {}
        for item in items:
            if item['id'] in BOARD_ALIASES:
                continue
            entry = copy.deepcopy(item)
            from backend.sensor_controls import add_sensor_controls
            add_sensor_controls(entry)
            if 'preset' in entry.get('tags', []) and entry.get('tagName') in ('wokwi-resistor','wokwi-capacitor','velxio-capacitor-electrolytic','wokwi-inductor'):
                entry['simulation_supported'] = True
                entry['simulation_scope'] = 'Existing ngspice passive model for DC/transient electrical analysis; not a digital MCU peripheral.'
                entry['spice_model'] = 'resistor' if entry['tagName'] == 'wokwi-resistor' else 'inductor' if entry['tagName'] == 'wokwi-inductor' else 'capacitor'
            # Generated decorators sometimes label numeric and boolean defaults as strings.
            for descriptor in entry.get('properties', []):
                default = descriptor.get('defaultValue')
                if descriptor.get('type') == 'string' and not descriptor.get('options'):
                    if type(default) is bool:
                        descriptor['type'] = 'boolean'
                    elif type(default) in (int, float):
                        descriptor['type'] = 'number'
            if item['id'] in ('ntc-temperature-sensor', 'photoresistor-sensor'):
                name, default, minimum, maximum = ('temperature', 25, -40, 125) if item['id'] == 'ntc-temperature-sensor' else ('lux', 500, 0, 1000)
                entry.setdefault('defaultValues', {})[name] = default
                if not any(prop['name'] == name for prop in entry.setdefault('properties', [])):
                    entry['properties'].append({'name':name,'type':'number','min':minimum,'max':maximum,'defaultValue':default,'control':'range'})
            if item['id'] == 'ssd1306' and not any(prop['name'] == 'protocol' for prop in entry.setdefault('properties', [])):
                entry['properties'].append({'name':'protocol','type':'select','options':['i2c','spi'],'defaultValue':'i2c','control':'select'})
            if item['id'] == 'hc-sr04':
                entry.setdefault('defaultValues', {})['distance'] = 10
                if not any(prop['name'] == 'distance' for prop in entry.setdefault('properties', [])):
                    entry['properties'].append({'name': 'distance', 'type': 'number', 'min': 2, 'max': 400, 'defaultValue': 10, 'control': 'range', 'unit': 'cm'})
            if item['id'] == 'bmp280':
                for name, default, minimum, maximum in [('temperature', 24, -40, 85), ('pressure', 1013.25, 300, 1100)]:
                    entry.setdefault('defaultValues', {})[name] = default
                    if not any(prop['name'] == name for prop in entry.setdefault('properties', [])):
                        entry['properties'].append({'name':name,'type':'number','min':minimum,'max':maximum,'defaultValue':default,'control':'range'})
                entry['properties'].append({'name':'i2cAddress','type':'select','options':['0x76','0x77'],'defaultValue':'0x76','control':'select'})
                entry['defaultValues']['i2cAddress'] = '0x76'
            if item['id'] == 'dht22':
                for name, default, minimum, maximum in [('temperature', 25, -40, 80), ('humidity', 50, 0, 100)]:
                    entry.setdefault('defaultValues', {})[name] = default
                    if not any(prop['name'] == name for prop in entry.setdefault('properties', [])):
                        entry['properties'].append({'name': name, 'type': 'number', 'min': minimum, 'max': maximum, 'defaultValue': default, 'control': 'range'})
            if item['id'] in ('neopixel', 'led-ring', 'neopixel-matrix'):
                entry['simulation_boards'] = ['arduino-uno']
                entry['simulation_scope'] = 'Original WS2812 pulse decoder with 5V/ground and Uno DIN GPIO; direct single/ring/matrix frames. DOUT chaining and power/current analysis are not implemented.'
            if item['id'] in ('membrane-keypad', 'ili9341', 'led-bar-graph'):
                entry['simulation_boards'] = ['arduino-uno']
                entry['simulation_scope'] = {
                    'membrane-keypad': 'Original passive 4x4 matrix model; eight distinct Uno D2-D13 GPIOs. No extra supply pins. Other column counts are unavailable.',
                    'ili9341': 'Original write-only SPI RGB565 display model with rotation; Uno MOSI11/SCK13 and distinct CS/D-C, 3.3V supply/backlight. Readback, touch and RST electrical behavior are not modeled.',
                    'led-bar-graph': 'Original ten-channel digital indicator; every used anode requires a distinct GPIO through a current-limiting resistor and its cathode to ground. No analog-current model.',
                }[item['id']]
            if item['id'] == 'dip-switch-8':
                entry['simulation_boards'] = ['arduino-uno', 'arduino-nano', 'arduino-mega']
                entry['simulation_scope'] = 'Independent grounded contacts: each used A pin to a distinct AVR GPIO and matching B pin to GND, with INPUT_PULLUP firmware. Contact bounce and other wiring modes are not modeled.'
            if item['id'] == 'slide-switch':
                entry['simulation_boards'] = ['arduino-uno', 'arduino-nano', 'arduino-mega']
                entry['simulation_scope'] = 'Rail-selected digital input: pin 1 to GND, pin 3 to 5V, pin 2 to a digital GPIO. Open-contact modes and contact bounce are not modeled.'
            if item['id'] == 'ky-040':
                entry['simulation_boards'] = ['arduino-uno', 'arduino-nano']
                entry['simulation_scope'] = 'Original rotary encoder digital pulses and active-low switch; requires distinct CLK/DT/SW GPIO and 5V/GND. Pulse spacing uses browser timers, not mechanical contact physics.'
            if item['id'] == 'analog-joystick':
                entry['simulation_boards'] = ['arduino-uno']
                entry['simulation_scope'] = 'Existing dual ADC axes and active-low pushbutton model; requires distinct VERT/HORZ ADC pins and SEL GPIO.'
            if item['id'] in ('gas-sensor','flame-sensor','big-sound-sensor','small-sound-sensor'):
                entry['simulation_boards'] = ['arduino-uno']
                entry['simulation_scope'] = 'Existing simplified ADC sensor model on Uno A0-A5; DOUT is only a GPIO-driven indicator, not a modeled sensor comparator.'
            if item['id'] in ('ntc-temperature-sensor', 'photoresistor-sensor', 'pir-motion-sensor'):
                entry['simulation_boards'] = ['arduino-uno']
                entry['simulation_scope'] = 'Existing Uno ADC/input model. NTC uses the original beta divider; photoresistor AO uses a simplified light-to-voltage mapping; PIR pulse uses browser wall time.'
            if item['id'] in ('ssd1306', 'ssd1306-i2c-4pin', 'lcd1602-i2c', 'lcd2004-i2c', 'mpu6050', 'ds1307', 'ds3231', 'bmp280'):
                entry['simulation_boards'] = ['arduino-uno']
                entry['simulation_scope'] = ('Existing Velxio SSD1306 I2C or hardware SPI model on Uno. SPI uses MOSI11/SCK13 plus distinct CS/DC GPIO; correct supply/ground are required.' if item['id'] == 'ssd1306' else 'Existing Velxio I2C model on Uno A4/SDA and A5/SCL; requires correct power, ground and address. Other interfaces and chip features are not certified.')
            extracted = COMPONENT_PINS.get(item['id'])
            matching_pins = extracted if extracted and extracted['tagName'] == entry.get('tagName') else None
            if matching_pins:
                entry['pinInfo'] = copy.deepcopy(matching_pins['pins'])
                entry['pin_provenance'] = 'backend/catalog/component-pins.json'
                for mode in ('pins', 'protocol'):
                    if mode in matching_pins.get('properties', {}):
                        entry.setdefault('defaultValues', {})[mode] = copy.deepcopy(matching_pins['properties'][mode])
            explicit = item['id'] in EXPLICIT_PIN_LAYOUTS
            entry['pins'] = copy.deepcopy(item.get('pins') or PIN_LAYOUTS.get(item['id'], [])) if explicit or matching_pins or item.get('pins') else []
            entry['connectable'] = bool(entry['pins'])
            if matching_pins and not explicit:
                entry['pinCount'] = len(entry['pins'])
            if item['id'] in ('potentiometer', 'servo', 'hc-sr04', 'slide-potentiometer', 'rgb-led', 'dht22'):
                entry['simulation_boards'] = ['arduino-uno', 'arduino-nano', 'arduino-mega', 'pi-pico', 'pi-pico-w'] if item['id'] == 'potentiometer' else ['arduino-uno'] if item['id'] == 'slide-potentiometer' else ['arduino-uno', 'arduino-nano', 'arduino-mega']
                entry['simulation_scope'] = {'potentiometer': 'ADC input from the Wokwi control; Nano A6/A7 are analog-only', 'slide-potentiometer': 'ADC input from the original slider control', 'rgb-led': 'Common-cathode digital/PWM channels; each channel requires a current-limiting resistor; no analog current model', 'dht22': 'Timed DHT22 protocol read by the Adafruit library; temperature/humidity controls, no physical environment model', 'servo': 'Angle from GPIO pulse widths; no torque or supply-current model', 'hc-sr04': 'Timed trigger/echo distance response; no acoustic interference model'}[item['id']]
            entry['pin_aliases'] = PIN_ALIASES.get(item['id'], {})
            entry['supported_board'] = item['id'] in BOARD_CONFIG if item.get('category') == 'boards' else None
            if item['id'] in BOARD_CONFIG:
                entry.update(BOARD_CONFIG[item['id']])
                entry['category'] = 'boards'
                entry['supported_board'] = True
                entry['aliases'] = [alias for alias, canonical in BOARD_ALIASES.items() if canonical == item['id']]
                entry['pinCount'] = len(entry['pins'])
            elif item.get('category') == 'boards':
                entry['compile'] = False
                entry['simulation'] = 'unavailable'
                entry['unavailable_reason'] = 'ESP32 requires QEMU, which is not configured.' if 'esp32' in item['id'] else 'This board runtime is not supported.'
            self.components[item['id']] = entry

    def search(self, query='', limit=50):
        if not isinstance(query, str) or len(query) > 200 or type(limit) is not int or not 1 <= limit <= 200:
            fail(400, 'Invalid component search query or limit.')
        needle = query.strip().casefold().removeprefix('wokwi-')
        def score(item):
            identity = str(item.get('id', '')).casefold()
            name = str(item.get('name', '')).casefold()
            tags = ' '.join(str(tag) for tag in item.get('tags', [])).casefold()
            if not needle:
                return 1
            if needle == identity or needle == name or needle in item.get('aliases', []):
                return 100
            if identity.startswith(needle) or name.startswith(needle):
                return 50
            if needle in identity or needle in name:
                return 20
            words = re.findall(r'[a-z]+', needle)
            if words and any(word == identity or word == name for word in words):
                return 30
            if needle in tags or needle in str(item.get('description', '')).casefold():
                return 5
            return 0
        matches = sorted((item for item in self.components.values() if score(item)), key=lambda item: (-score(item), str(item.get('name', item['id']))))
        return {'components': copy.deepcopy(matches[:limit]), 'boards': copy.deepcopy(BOARDS), 'origin': self.origin}
