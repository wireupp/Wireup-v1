"""Board catalogue, pin layouts and component pin data.

Split out of the former single backend/hardware.py module during phase v01. Pure data and
lookup helpers; no service state and no HTTP.

NOTE: this module is a verbatim slice of the original file. An earlier hand-sliced version
silently dropped eight PIN_LAYOUTS entries (every ESP32 and Raspberry Pi board), which made
this module raise KeyError on import and broke the backend entirely. scripts/
check-imports.py now executes it so that cannot recur silently.
"""

import json
import math
import re
from pathlib import Path

# The repository root. This module lives at backend/hardware/boards.py, so the root is two
# levels up. The pre-split backend/hardware.py sat one level shallower and used parents[1];
# copying that value made ROOT resolve to backend/, and every ROOT-relative path silently
# became backend/backend/... which loaded zero component pins instead of raising.
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = '''void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
'''
TOOLS = (
    'read_project', 'search_components', 'add_component', 'remove_component',
    'modify_component', 'connect_wire', 'remove_wire', 'check_connections', 'generate_firmware',
    'read_firmware', 'edit_firmware', 'compile_firmware', 'run_simulation',
    'stop_simulation', 'read_simulation_results', 'read_compiler_errors', 'calculator',
)
BOARDS = [
    {'id': 'arduino-uno', 'name': 'Arduino Uno', 'fqbn': 'arduino:avr:uno',
     'compile': True, 'simulation': 'browser', 'format': 'hex', 'runtime': 'avr8js', 'tagName': 'wokwi-arduino-uno'},
    {'id': 'arduino-nano', 'name': 'Arduino Nano (ATmega328P)', 'fqbn': 'arduino:avr:nano:cpu=atmega328',
     'compile': True, 'simulation': 'browser', 'format': 'hex', 'runtime': 'avr8js', 'tagName': 'wokwi-arduino-nano'},
    {'id': 'arduino-mega', 'name': 'Arduino Mega 2560', 'fqbn': 'arduino:avr:mega:cpu=atmega2560',
     'compile': True, 'simulation': 'browser', 'format': 'hex', 'runtime': 'avr8js-mega', 'tagName': 'wokwi-arduino-mega'},
    {'id': 'pi-pico', 'name': 'Raspberry Pi Pico', 'fqbn': 'rp2040:rp2040:rpipico',
     'compile': True, 'simulation': 'browser', 'format': 'bin', 'runtime': 'rp2040js', 'tagName': 'wokwi-pi-pico',
     'compile_timeout_seconds': 300},
]
BOARDS.extend([
    {'id': 'pi-pico-w', 'name': 'Raspberry Pi Pico W', 'fqbn': 'rp2040:rp2040:rpipicow',
     'compile': True, 'simulation': 'browser', 'format': 'bin', 'runtime': 'rp2040js',
     'simulation_scope': 'RP2040 CPU, external GPIO, UART0; no CYW43 radio or onboard LED',
     'tagName': 'wokwi-pi-pico-w', 'compile_timeout_seconds': 300, 'wifi': False, 'bluetooth': False,
     'unavailable_reason': 'Pico W CPU and external GPIO/UART0 are supported; CYW43 WiFi/Bluetooth and its onboard LED are not emulated.'},
])
for board_id, name, target, chip, bootloader_offset in [
    ('esp32-devkit-v1', 'ESP32 DevKit V1', 'esp32doit-devkit-v1', 'esp32', 0x1000),
    ('esp32-devkit-c-v4', 'ESP32 DevKit C V4', 'esp32', 'esp32', 0x1000),
    ('esp32-s3', 'ESP32-S3 DevKitC-1', 'esp32s3', 'esp32s3', 0),
    ('esp32-c3', 'ESP32-C3 DevKitM-1', 'esp32c3', 'esp32c3', 0),
]:
    BOARDS.append({'id': board_id, 'name': name, 'fqbn': f'esp32:esp32:{target}',
                   'compile': True, 'simulation': 'browser' if chip in ('esp32c3', 'esp32s3') else 'unavailable', 'format': 'bin', 'runtime': 'esp-emu-wasm' if chip in ('esp32c3', 'esp32s3') else 'qemu',
                   'tagName': 'wokwi-' + board_id, 'chip': chip, 'bootloader_offset': bootloader_offset,
                   'flash_size_bytes': 4 * 1024 * 1024, 'compile_timeout_seconds': 600,
                   'wifi': False, 'bluetooth': False,
                   'simulation_scope': 'Official Espressif WASM CPU, UART0 and sampled external GPIO; no connected sensor buses or real networking' if chip in ('esp32c3', 'esp32s3') else None,
                   'unavailable_reason': 'Classic ESP32 requires the compatible patched native Velxio QEMU runtime; the official WASM emulator does not support this chip.' if chip == 'esp32' else None})
for model in (3, 4, 5):
    BOARDS.append({'id': f'raspberry-pi-{model}', 'name': f'Raspberry Pi {model}', 'fqbn': None,
                   'compile': False, 'simulation': 'unavailable', 'format': None, 'runtime': 'qemu-linux',
                   'tagName': f'velxio-raspberry-pi-{model}',
                   'unavailable_reason': 'Raspberry Pi Linux boards require a native runtime and guest Linux image; Arduino firmware compilation is not supported.'})
BOARD_CONFIG = {board['id']: board for board in BOARDS}
BOARD_ALIASES = {'raspberry-pi-pico': 'pi-pico', 'raspberry-pi-pico-w': 'pi-pico-w',
                 'esp32': 'esp32-devkit-v1'}
PIN_LAYOUTS = {
    'arduino-uno': [str(i) for i in range(14)] + [f'A{i}' for i in range(6)]
                   + ['GND.1', 'GND.2', 'GND.3', '5V', '3.3V', 'VIN', 'AREF', 'RESET', 'IOREF', 'A4.2', 'A5.2'],
    'arduino-nano': [str(i) for i in range(14)] + [f'A{i}' for i in range(8)]
                    + ['3.3V', 'AREF', '5V', 'VIN', 'RESET', 'RESET.2', 'RESET.3',
                       'GND.1', 'GND.2', 'GND.3', '12.2', '13.2', '11.2', '5V.2'],
    'arduino-mega': [str(i) for i in range(54)] + [f'A{i}' for i in range(16)]
                    + ['SCL', 'SDA', 'AREF', 'IOREF', 'RESET', '3.3V', '5V', '5V.1', '5V.2', 'VIN']
                    + [f'GND.{i}' for i in range(1, 6)],
    'pi-pico': [f'GP{i}' for i in list(range(23)) + [26, 27, 28]]
               + [f'GND.{i}' for i in range(1, 9)]
               + ['VBUS', 'VSYS', '3V3_EN', '3V3', 'ADC_VREF', 'RUN'],
    'source-dc-voltage': ['+', '-'], 'source-dc-current': ['+', '-'],
    'source-sine-voltage': ['+', '-'], 'source-pulse-voltage': ['+', '-'],
    'source-pwl-voltage': ['+', '-'], 'source-ac-voltage': ['+', '-'], 'ground': ['GND'],
    'led': ['A', 'C'], 'resistor': ['1', '2'], 'capacitor': ['1', '2'], 'inductor': ['1', '2'],
    'pushbutton': ['1.l', '1.r', '2.l', '2.r'], 'potentiometer': ['GND', 'SIG', 'VCC'],
    'buzzer': ['1', '2'], 'servo': ['GND', 'V+', 'PWM'],
    'dht22': ['VCC', 'SDA', 'NC', 'GND'], 'hc-sr04': ['VCC', 'TRIG', 'ECHO', 'GND'],
    'rgb-led': ['R', 'G', 'B', 'COM'], 'neopixel': ['VDD', 'VSS', 'DIN', 'DOUT'],
}
# Pin names match the installed Wokwi DevKit V1 element and vendored Esp32Element wrappers.
PIN_LAYOUTS['slide-potentiometer'] = ['VCC', 'SIG', 'GND']
PIN_LAYOUTS['ssd1306'] = ['DATA', 'CLK', 'DC', 'RST', 'CS', '3V3', 'VIN', 'GND']
PIN_LAYOUTS['ssd1306-i2c-4pin'] = ['GND', 'VCC', 'SCL', 'SDA']
PIN_LAYOUTS['lcd1602-i2c'] = ['GND', 'VCC', 'SDA', 'SCL']
PIN_LAYOUTS['lcd2004-i2c'] = ['GND', 'VCC', 'SDA', 'SCL']
PIN_LAYOUTS['ntc-temperature-sensor'] = ['GND', 'VCC', 'OUT']
PIN_LAYOUTS['photoresistor-sensor'] = ['VCC', 'GND', 'DO', 'AO']
PIN_LAYOUTS['pir-motion-sensor'] = ['VCC', 'OUT', 'GND']
PIN_LAYOUTS['mpu6050'] = ['INT', 'AD0', 'XCL', 'XDA', 'SDA', 'SCL', 'GND', 'VCC']
PIN_LAYOUTS['ds1307'] = ['GND', '5V', 'SDA', 'SCL', 'SQW']
PIN_LAYOUTS['ds3231'] = ['GND', 'VCC', 'SDA', 'SCL']
PIN_LAYOUTS['bmp280'] = ['SDA', 'SCL', 'GND', 'VCC']
PIN_LAYOUTS.update({
    'esp32-devkit-v1': ['VIN', 'GND.2', 'D13', 'D12', 'D14', 'D27', 'D26', 'D25', 'D33', 'D32',
                         'D35', 'D34', 'VN', 'VP', 'EN', '3V3', 'GND.1', 'D15', 'D2', 'D4',
                         'RX2', 'TX2', 'D5', 'D18', 'D19', 'D21', 'RX0', 'TX0', 'D22', 'D23'],
    'esp32-devkit-c-v4': ['3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27',
                           '14', '12', 'GND.1', '13', 'D2', 'D3', 'CMD', '5V', 'GND.2', '23',
                           '22', 'TX', 'RX', '21', 'GND.3', '19', '18', '5', '17', '16', '4',
                           '0', '2', '15', 'D1', 'D0', 'CLK'],
    'esp32-s3': ['3V3.1', '3V3.2', 'RST', '4', '5', '6', '7', '15', '16', '17', '18', '8',
                  '3', '46', '9', '10', '11', '12', '13', '14', '5V', 'GND.1', 'GND.2',
                  'TX', 'RX', '1', '2', '42', '41', '40', '39', '38', '37', '36', '35',
                  '0', '45', '48', '47', '21', '20', '19', 'GND.3', 'GND.4'],
    'esp32-c3': ['GND.1', '3V3.1', '3V3.2', '2', '3', 'GND.2', 'RST', 'GND.3', '0', '1',
                  '10', 'GND.4', '5V.1', '5V.2', 'GND.5', 'GND.6', '19', '18', 'GND.7',
                  '4', '5', '6', '7', 'GND.8', '8', '9', 'GND.9', 'RX', 'TX', 'GND.10'],
    'pi-pico-w': PIN_LAYOUTS['pi-pico'][:],
})
# Linux Pi wrappers share BCM header names, including repeated power/ground labels.
for model in (3, 4, 5):
    PIN_LAYOUTS[f'raspberry-pi-{model}'] = ['3V3', '5V', 'GND', 'ID_SD', 'ID_SC'] + [
        f'GPIO{i}' for i in range(2, 28)]
PIN_ALIASES = {
    'arduino-uno': {**{f'D{i}': str(i) for i in range(14)}, 'GND': 'GND.1', 'TX': '1', 'RX': '0'},
    'pi-pico': {'A0': 'GP26', 'A1': 'GP27', 'A2': 'GP28'},
    'pi-pico-w': {'A0': 'GP26', 'A1': 'GP27', 'A2': 'GP28'},
    'esp32-devkit-v1': {**{pin[1:]: pin for pin in PIN_LAYOUTS['esp32-devkit-v1'] if pin.startswith('D')},
                        '16': 'RX2', '17': 'TX2', '1': 'TX0', '3': 'RX0', '36': 'VP', '39': 'VN',
                        'GND': 'GND.1'},
}


def load_component_pins(path=None):
    path = Path(path) if path else ROOT / 'backend/catalog/component-pins.json'
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding='utf-8'))
    if data.get('schema_version') != 1 or not isinstance(data.get('components'), dict):
        raise ValueError('Invalid component pin catalog schema.')
    verified = {}
    for kind, record in data['components'].items():
        if not isinstance(record, dict) or record.get('defined') is not True or record.get('status') != 'verified':
            continue
        pins = record.get('pins')
        if not isinstance(pins, list) or not pins or record.get('pinCount') != len(pins):
            continue
        if any(not isinstance(pin, dict) or not isinstance(pin.get('name'), str) or not pin['name']
               or any(type(pin.get(axis)) not in (int, float) or not math.isfinite(pin[axis]) for axis in ('x', 'y'))
               for pin in pins):
            continue
        names = [pin['name'] for pin in pins]
        if len(set(names)) != len(names):
            continue
        verified[kind] = record
    return verified


EXPLICIT_PIN_LAYOUTS = frozenset(PIN_LAYOUTS)
COMPONENT_PINS = load_component_pins()
# Explicit layouts retain runtime pin names and board aliases.
for _kind, _record in COMPONENT_PINS.items():
    if not PIN_LAYOUTS.get(_kind):
        PIN_LAYOUTS[_kind] = [pin['name'] for pin in _record['pins']]


DEFAULT_BOARD_SOURCES = {
    'esp32-devkit-c-v4': 'void setup() {\n  Serial.begin(115200);\n}\n\nvoid loop() {\n  delay(500);\n}\n',
}
