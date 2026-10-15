import { legacyBrowserSolver } from '../legacy-adapter.mjs';

export const mcuSolver = legacyBrowserSolver({
  id: 'mcu',
  version: '1',
  scopes: ['browser', 'uno'],
  analyses: ['firmware'],
  targets: ['arduino-uno', 'arduino-nano', 'arduino-mega', 'pi-pico', 'pi-pico-w'],
  limits: { maxNodes: 512, maxSimSeconds: 300, maxSubsteps: 200000, payloadBytes: 200000 },
  tests: ['electronics/blink', 'mcu/pico-runtime'],
  knownFailures: [
    {
      code: 'ESP32_C3_PC_FAILURE',
      condition: 'ESP32-C3 execution using the vendor RiscVCore adapter.',
      message: 'Vendor RiscVCore adapter fails at PC 0x514c26 after 2,666,667 cycles.',
    },
    {
      code: 'PICO_W_CYW43_UNSUPPORTED',
      condition: 'Pico W firmware uses CYW43 radio, WiFi, Bluetooth, or the onboard LED.',
      message: 'Pico W radio (CYW43), WiFi, Bluetooth and the CYW43-controlled onboard LED are unsupported.',
    },
  ],
  unavailable: [
    {
      feature: 'ESP32-C3 execution',
      kind: 'board.esp32-c3',
      reason: 'The native runtime fails at PC 0x514c26 after 2,666,667 cycles.',
      requiredToSupport: 'A verified ESP32-C3 emulator run that passes the documented firmware fixtures.',
    },
    {
      feature: 'Pico W radio and onboard LED',
      kind: 'board.pi-pico-w',
      reason: 'Only external GPIO and UART0 are emulated; CYW43, WiFi, Bluetooth and the onboard LED are unsupported.',
      requiredToSupport: 'A verified CYW43 and onboard LED model with passing firmware fixtures.',
    },
  ],
});
