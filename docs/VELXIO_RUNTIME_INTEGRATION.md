<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Velxio runtime integration — Uno milestone

WireUp keeps the existing `HardwareRuntime`, CPU artifact loader, compiler, canvas, serial monitor and project ownership. It now attaches selected upstream `PartSimulationRegistry` handlers to the same existing AVRSimulator instance; no second CPU engine or circuit store owns the project.

## WS2812 addressable outputs

Uno now attaches the original SensorParts WS2812 decoder for the single NeoPixel, LED ring, and NeoPixel matrix. Real Adafruit NeoPixel library firmware sends GRB frames, and UART-controlled changes update the actual rendered output. The ring/matrix callbacks normalize original decoder byte values to the Wokwi element's 0–1 colour interface. Power/ground/DIN connections are validated. DOUT chaining, current limits, power budgets, other boards, and single-frame retention across late element replacement are not certified. Repeated firmware frames and stop/restart were verified.

## Prototype input and colour display additions

The original passive 4x4 membrane-keypad model is integrated on Uno with eight distinct D2–D13 GPIOs. Real raw-scanning firmware verifies all sixteen keys in both scan directions, release, held-key detach and stop/restart. It has no VCC/GND pins. Other matrix sizes and ghosting/diode variants are not claimed.

ILI9341 uses the original write-only SPI RGB565 model through the existing local bus, including four display rotations and sharing MOSI/SCK with an OLED using separate chip-select pins. Tests use the installed Adafruit library. Supply/backlight must connect to 3.3V with ground. Read commands, touch and electrical reset-pad fidelity are not integrated.

The ten-channel LED bar uses original GPIO subscriptions. Each used anode is validated through a series resistor and its matching cathode on ground. Real firmware toggles alternating ten-channel patterns and reattaches after stop/restart. It does not model LED currents.

All three additions are advertised only for Uno. Broader motor drivers and relays require solved-net-to-model coupling; existing visual presence and pin maps do not establish that support.

## KY-040 rotary encoder

Uno and Nano now attach the original BasicParts encoder handler. Real compiled interrupt firmware counted clockwise/counterclockwise events and read the active-low switch. Connect CLK/DT/SW to distinct digital-capable GPIO plus 5V/GND. Browser-timer pulse spacing is a simplified interaction model, not mechanical contact physics. Pending pulse timers are cancelled on detach/stop. Mega failed the actual external-interrupt test and remains disabled in this adapter until its upstream interrupt map is fixed.

## Rail-selected slide switch

Uno/Nano/Mega now use the original BasicParts handler with pin 1 wired to GND, pin 3 wired to 5V and the common pin 2 wired to a digital GPIO. The handler only drives a level directly when both actual rail connections are verified. Firmware pull-up changes do not override that sourced input. Real compiled `digitalRead()` tests pass in both positions and across stop/restart. Other open-contact wiring modes, switch bounce and Pico integration remain unavailable.

## Eight-position DIP switch

Uno/Nano/Mega now attach the original BasicParts DIP handler with per-channel ground checks. Each used A-side pin connects to a distinct digital GPIO; its matching B-side pin connects to ground. Real firmware with INPUT_PULLUP reads HIGH when open and LOW when closed, independently across channels. Other wiring modes, contact bounce, and floating-input voltage behavior are not modeled. Lifecycle cleanup restores pull callbacks and removes event listeners.

## Implemented scope

| Component | Reused upstream implementation | Required connections | Verified behavior |
| --- | --- | --- | --- |
| Potentiometer | `ComplexParts.ts` ADC helper | VCC to Uno 5V, GND to ground, SIG to A0–A5 | Real `analogRead()` values change with the control |
| Servo | `ComplexParts.ts` cycle-based pulse decoder | V+ to 5V, GND to ground, PWM to GPIO | Actual GPIO pulse widths update angle; no torque/current model |
| HC-SR04 | `SensorParts.ts` + `line/models/hc-sr04.ts` | 5V, ground, distinct TRIG/ECHO GPIO | Real `pulseIn()` sees distance-dependent timed echo |

`velxioParts.ts` translates canonical parts and wires into the upstream `PinTrace` interface, including breadboard groups and series resistor tracing. It refuses missing power/signal connections and disables the upstream unwired-servo fallback. ADC and sensor updates reuse upstream helpers. Cleanup occurs on stop, restart, element replacement, project changes and disposal.

The existing LED and rail-aware pushbutton behaviors remain.

## Additional verified board/component combinations

- Nano and Mega: rotary potentiometer, servo pulse decoding, and HC-SR04 echo timing passed real compiled-firmware tests. Nano A6/A7 remain analog-only.
- Mega A8–A15: the existing avr8js ADC configuration now includes the ATmega2560 MUX5 channel bank and sixteen channels. A15 was verified with real `analogRead()` firmware.
- Pico and Pico W: rotary potentiometer uses the upstream RP2040 ADC path, with 3V3/GND power and exposed GP26–GP28 input. Real firmware and control-change tests passed using UART0 (`Serial1`).
- Slide potentiometer: original Wokwi pins were verified and added to the canonical catalog. Uno ADC readings and control changes passed. The generalized slider adapter on other boards is not advertised as verified.

Pico servo and HC-SR04 remain disabled. Direct 5V echo into a 3.3V input must not be presented as safe; a verified level-shifting integration is still needed. Pico W wireless and onboard CYW43 LED remain unavailable.

A transient Windows project-file replacement lock found during testing now retries atomic replacement briefly without switching to non-atomic writes.

## Lifecycle

- `HardwareRuntime.run`: validate and load actual compiler artifact; attach selected part behavior; start the existing CPU.
- `registerElement`: attach late-mounted components and release replaced ones.
- `updateProject`: stop simulation when topology changes; forward property-only changes to actual part models.
- `stop` / `dispose`: remove event listeners and line leases; preserve truthful stopped results.
- Runtime results expose actual peripheral attachment state, values and support warnings.

## Verification and limitations

Real compiled firmware tests passed for potentiometer ADC, servo pulse response, and HC-SR04 pulse/echo. Stop/restart/reload and an unwired-servo case are included. Existing upstream behavior is not electrical safety certification. Analog current, mechanical loads, acoustic interference and broader peripheral families remain out of scope.

## RGB and DHT22 extension

- Uno/Nano/Mega now use the original `ComplexParts.ts` RGB handler with common-cathode COM-to-ground and wired R/G/B pins. A small upstream fix preserves actual PWM duty after a digital-edge callback, rather than flashing each channel at 255. Real `analogWrite(64/128/192)` firmware tests passed on all three boards. Common-anode rendering is not supported by this adapter; channel resistors and power budgets remain necessary.
- Uno/Nano/Mega DHT22 uses `ProtocolParts.ts` and the existing timed-line model. The installed Adafruit `DHT.h` reader compiled and returned 50%/25°C, then 65%/18°C after control changes, on all three boards. The earlier custom `pulseIn()` decoder was not a valid protocol test. Timing fidelity remains limited by the original model; this does not certify physical behavior.
- These new parts remain disabled on Pico/Pico W pending their own timing and power-level tests. Element replacement during a pending DHT/HC response stops the AVR before releasing the lease.

## Uno I²C display and sensor integration

The current Uno adapter connects the existing AVR TWI controller to a runtime-local upstream `BusRegistry`, using the actual canonical wiring as its resolver. Original registration hooks are redirected only during synchronous model attachment and restored in `finally`; no duplicate controller, decoder, or simulator is created.

Verified original models include SSD1306 I²C, LCD1602/LCD2004 I²C, MPU6050, DS1307 and DS3231. Real firmware tests cover OLED ACK/pixels, LiquidCrystal text, MPU device identity, and RTC register writes/reads. Correct SDA=A4, SCL=A5, power and ground are required. Address changes reattach targets; collision diagnostics are surfaced. Unwired devices must not acknowledge.

These paths are enabled only on Uno. MPU motion accuracy, RTC physical oscillator characteristics, LCD busy timing, other board buses, and electrical safety are not certified.

## Uno SSD1306 hardware SPI

The eight-pin SSD1306 now reuses the original SPI model through the same runtime-local bus registry and the existing AVR SPI controller. Connect DATA to D11, CLK to D13, distinct CS/DC GPIOs, and appropriate VIN/3V3 plus ground. Protocol selection is validated; four-pin OLED remains I²C-only. Real compiled SPI firmware renders pixels and passes stop/restart, with the I²C regression also passing. RST wiring is validated, but the upstream model does not emulate the RST pad; reset fidelity must not be claimed. SD cards, RFID and other SPI peripherals remain unintegrated. The original models retain their documented limitations. Peripheral pins were read from the actual registered Wokwi/Velxio elements before catalog enablement.

## Uno BMP280

BMP280 now reuses the original ProtocolParts register model through the existing local I²C bus. Its actual element pins are SDA/SCL/GND/VCC. The integration requires 3.3V and ground with Uno A4/A5, supports address 0x76/0x77, and exposes bounded temperature (-40–85°C) and pressure (300–1100 hPa) controls. Real Adafruit BMP280 library firmware read 24°C/1013.25 hPa, then updated to 30°C/950 hPa after changing controls and restarting. Sensor accuracy and electrical safety are not physically verified; other boards/SPI remain unenabled.

## Additional Uno sensors and examples

The original photoresistor AO model, NTC beta-divider model, and PIR digital-input model are now attached on Uno. Real firmware tests verify light/temperature ADC changes and a motion-triggered digital HIGH. Photoresistor DO is only an indicator path; PIR's three-second pulse uses browser wall time, not guest-cycle timing. These are explicit modeling limitations.

All 321 examples are dynamically classified using their actual canonical mapping and selected-board model coverage: currently 45 have simulation-ready hardware, 38 open with partial support, and 238 remain blocked by real import/pin/component limitations. Opening keeps original firmware and dependencies; readiness is not a claim that every example has been compiled/run. The normal project compile/run flow is reused. See `SIMULATION_INTEGRATION_BACKLOG.md` for the complete 172-component inventory and remaining bus/analog/model work.

Run:

```powershell
npx playwright test tests/uno-peripherals.spec.ts --workers=1
python -m pytest backend/tests/test_uno_sensor_controls.py -q
```
