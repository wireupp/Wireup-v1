"""Board catalogue, pin layouts and component pin data.

Split out of the former single backend/hardware.py module during phase v01. Pure data and
lookup helpers; no service state and no HTTP.
"""

import json
import math
import re
from pathlib import Path



ROOT = Path(__file__).resolve().parents[1]


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


DEFAULT_BOARD_SOURCES = {
    'esp32-devkit-c-v4': 'void setup() {\n  Serial.begin(115200);\n}\n\nvoid loop() {\n  delay(500);\n}\n',
}
