<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Simulation integration backlog — exhaustive catalog/registry inventory

## Scope and reconciliation

Read-only source inspection on 2026-10-08. This document is the only requested write; no implementation, model, engine, metadata, or test changes were made. No browser/firmware tests were executed for this inventory. “Enabled” below means actual source admission, not newly verified behavior.

**172 is the backend catalog count, not the PartSimulationRegistry count.** Both public metadata catalogs contain 157 entries. `backend/hardware.py::ComponentCatalog` adds eight missing board entries and seven schematic source/ground entries, giving **172 distinct IDs**. The full upstream `simulation/parts/index.ts` side-effect imports yield **83 registry IDs**, including eight dynamically registered ePaper IDs: **78 catalog matches and five registry-only IDs**. All 172 catalog IDs are classified below; the five additional registry IDs are separately inventoried.

**Current `src/hardware/velxioParts.ts` selects 13 IDs:** potentiometer, slide-potentiometer, servo, hc-sr04, rgb-led, dht22, ssd1306, ssd1306-i2c-4pin, lcd1602-i2c, lcd2004-i2c, mpu6050, ds1307, ds3231. Local LED/pushbutton behavior is separate. Eager imports include only PartSimulationRegistry, ComplexParts, SensorParts, ProtocolParts and supporting tracing/update/line modules, not the full upstream parts index. Loading a handler is not selecting it, binding its engine dependencies, or certifying its pins/power.

**130 of 172 IDs have empty backend-approved `pins`; 42 have nonempty pins.** Backend wiring legality comes from explicit `PIN_LAYOUTS`, not metadata `pinCount`. Frontend `HardwarePart` reads DOM `pinInfo` for geometry, but that does not make those labels legal for backend `connect_wire`. For example BMP280 metadata/element exposes four pins while its backend entry exposes none. Some pinless IDs are intentionally wireless/topological; others are concrete wiring blockers.

## Classification and dependency profiles

Every catalog row below contains an exact ID, source model/classification, actual backend pins, and a dependency profile. Profiles are part of each row's classification, not a claim that every member has identical hardware behavior.

- **I:** admitted by current VelxioParts; board/power/pin/protocol restrictions still apply.
- **L:** existing local digital behavior outside upstream registry integration.
- **R:** actual upstream handler exists but is not admitted. **P** means missing backend pins and/or controls.
- **S:** existing upstream SPICE emitter; current app whitelist/live MCU bridge does not admit it.
- **A:** existing separate schematic ngspice path, not an MCU peripheral.
- **E:** existing upstream digital engine/controller needs binding; no exact part-registry handler.
- **T:** topology, not an attachEvents model.
- **B:** board runtime/configuration, not a part handler.
- **G:** insufficient/missing behavior or board admission, distinguished from missing adapters.

| Profile | Actual requirements and limitations |
|---|---|
| AVR | Existing AVRSimulator/avr8js CPU, GPIO, timers, ADC and UART. Uno/Nano/Mega admitted; peripheral scope is not inherited from CPU support. Nano A6/A7 are analog-only. |
| RP | Existing RP2040Simulator/rp2040js. Adapter enables rotary/slide potentiometers only on external GP26–GP28 with 3V3/GND. No GP29, second-core or USB CDC assurance; Pico W CYW43 wireless/onboard LED absent. |
| REMOTE | ESP boards need native QEMU/bridge configuration; Linux Pi needs native guest Linux/runtime. No normal admitted browser path for these boards, except separate experimental C3 described below. |
| POT | Existing ComplexParts ADC handler, input event; rotary SIG, slide SIG/OUT. AVR VCC=5V/GND and board ADC pin, Pico 3V3/GND. Slide min/max/value normalization; rotary 0–1023 voltage mapping. Reset ADC on detach. |
| ADC | Existing partUtils.setAdcVoltage and SensorUpdateRegistry. AVR writes volts to ADC channels (Uno A0–A5, Nano A0–A7, Mega A0–A15). NTC scales to board rail; photoresistor/gas/flame/sound hardcode 5V: initially scope these to Uno. Add actual input descriptors, initial saved-value synchronization, bounds and ADC cleanup. Indicator properties are not sensor input controls. |
| GPIO-IN | Explicit signal GPIO, real ground/supply and high-impedance pad ownership; reset seeded input on detach. Switches need correct contact wiring/pulls, not generic VCC validation. |
| GPIO-OUT | Existing PinManager digital/PWM subscriptions. Validate return path/current-limiting resistors where appropriate and capture output values; no solved current or safety certification. |
| LINE | Existing requestLine and guest pad/timing models; exclusive pin ownership, capability refusal, lease release and pending-edge stop policy. DHT22/HC-SR04 are already scoped to AVR; keypad/IR are not automatically enabled. |
| I2C | Existing project-local VelxioBus/BusRegistry/resolver/TWI binding. Current gate is Uno A4/SDA=18 and A5/SCL=19, explicit correct power/GND, validated address/collision diagnostics. It intercepts attachI2c only during synchronous attach; global hooks restored in finally. No SPI or other-board I2C admission. |
| SPI | Reuse existing upstream SPI fabric and engine hooks, SCK/MOSI/CS plus MISO where applicable; DC/RST/BUSY GPIO for displays. Current VelxioBus binds spi: [] and does not intercept attachSpiDevice, so extending selected is insufficient. Scope handles/reset/diagnostics and virtual output ownership. |
| UART | Reuse existing UART fabric, endpoint/net resolver, guest clock and conflict-safe serial ownership. Current VelxioBus omits UART and does not intercept attachUartEndpoint. |
| PIXEL | Existing WS2812 decoder needs actual guest cycles/nanos and DIN edges or hardware subscribeWs2812 feed. AVR bit-bang is the safest first scope; RP PIO/ESP RMT feeds are not guaranteed by CPU support. Isolate upstream run-epoch/power-cut store subscriptions and test blanking/chain routing. |
| NET | Existing handlers/engines require peripheral/virtual nets, thresholds and drive-contention propagation. Current resolver traces to MCU pins and rejects active crossings; it cannot cover arbitrary gate chains or driver outputs. Reuse upstream Interconnect/PinResolver/digitalGateEngine/controller and existing bridges, not a new engine. |
| ELECTRICAL | Real upstream componentToSpice mapper; exact polarity/package pins and defaults, existing solver/netlist integration needed. Current local analogPins excludes these IDs; HardwareRuntime has no live MCU/SPICE voltage/current feedback. Never replace nonlinear devices with fake GPIO models. |
| PASSIVE | Real upstream R/L/C preset/base SPICE mapper; preset value and polarity preserved. Local analog whitelist excludes preset IDs, backend pins empty. No attachEvents needed; broaden existing solver/schema only if requested. |
| TOPOLOGY | Existing upstream PinTrace/NetlistBuilder breadboard/node topology. Expose real labels and shared-net routing. Local LED/button connectedEndpoints crosses generic resistor only, not breadboard strips. |

### Common integration constraints

Selected parts require exactly one selected board. Trace/power checks must remain board-specific, reject active-device crossing, unwired fallback and invalid pin ranges. Rails are validated separately; current signal resolver returns null for rails, unlike upstream handlers that sometimes depend on -1 rail sentinel. A new passive switch cannot simply pass the existing generic VCC/V+ gate. Generic resistor traversal is digital continuity, not Ohm's law.

Property writes call `Object.assign` and dispatch numeric/boolean sensor updates; they do not automatically synthesize switch array changes, joystick motion events, or discrete PIR/tilt actions. Add legitimate controls and matching handler events/keys. Release callbacks, timers, GPIO seeds, ADC channels, audio and bus/line handles on stop/reset/removal/rewire. No-op cleanup does not prove a peripheral attached successfully.

## Group coverage

Counts preserve actual catalog categories, including `sensor` versus `sensors` and misplaced board IDs. Registry counts include callback-only stubs. The following summary and all per-ID rows are checked against the actual ComponentCatalog.

| Group | Catalog IDs | Registry matches | Adapter IDs | Nonempty backend pins |
|---|---:|---:|---:|---:|
| analog | 38 | 0 | 0 | 7 |
| boards | 12 | 1 | 0 | 12 |
| displays | 15 | 15 | 4 | 4 |
| electromech | 2 | 0 | 0 | 0 |
| input | 6 | 6 | 1 | 2 |
| logic | 25 | 18 | 0 | 0 |
| motors | 4 | 4 | 1 | 1 |
| other | 18 | 17 | 3 | 3 |
| output | 5 | 5 | 1 | 4 |
| passive | 37 | 2 | 0 | 3 |
| sensor | 1 | 1 | 0 | 0 |
| sensors | 9 | 9 | 6 | 6 |
| **Total** | **172** | **78** | **13** | **42** |


## Upstream source abbreviations

All are under `vendor/velxio/frontend/src/simulation/parts/` unless specified: **Basic**=BasicParts.ts, **Complex**=ComplexParts.ts, **Sensor**=SensorParts.ts, **Protocol**=ProtocolParts.ts, **Chip**=ChipParts.ts, **Logic**=LogicGateParts.ts, **Motor**=MotorDriverParts.ts, **GPS**=GpsParts.ts, **ePaper**=EPaperPart.ts. **SPICE** means an exact emitter in `simulation/spice/componentToSpice.ts` (including preset aliases). ActiveParts explicitly does not register semiconductor attachEvents; a missing registry entry is not a missing electrical model.

## Complete per-ID inventory

Backend pins are literal approved labels; ∅ means no backend pins. Long board pin lists are counted and referenced to PIN_LAYOUTS. Physical pin requirements in notes are inspected handler/element contracts, not approved pins added by this report.

### analog — 38 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `battery-9v` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical +/−; verify package pinInfo. No digital attach expected. |
| `battery-aa` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical +/−; verify package pinInfo. No digital attach expected. |
| `battery-coin-cell` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical +/−; verify package pinInfo. No digital attach expected. |
| `bjt-2n2222` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical C/B/E; verify package pinInfo. No digital attach expected. |
| `bjt-2n3055` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical C/B/E; verify package pinInfo. No digital attach expected. |
| `bjt-2n3906` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical C/B/E; verify package pinInfo. No digital attach expected. |
| `bjt-bc547` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical C/B/E; verify package pinInfo. No digital attach expected. |
| `bjt-bc557` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical C/B/E; verify package pinInfo. No digital attach expected. |
| `diode` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical A/C; verify package pinInfo. No digital attach expected. |
| `diode-1n4007` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical A/C; verify package pinInfo. No digital attach expected. |
| `diode-1n4148` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical A/C; verify package pinInfo. No digital attach expected. |
| `diode-1n5817` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical A/C; verify package pinInfo. No digital attach expected. |
| `diode-1n5819` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical A/C; verify package pinInfo. No digital attach expected. |
| `ground` | A | No part-registry entry | GND | ELECTRICAL: existing local validated separate schematic source/ground solver; no live MCU power binding. |
| `mosfet-2n7000` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical D/G/S; verify package pinInfo. No digital attach expected. |
| `mosfet-fqp27p06` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical D/G/S; verify package pinInfo. No digital attach expected. |
| `mosfet-irf540` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical D/G/S; verify package pinInfo. No digital attach expected. |
| `mosfet-irf9540` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical D/G/S; verify package pinInfo. No digital attach expected. |
| `opamp-ideal` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical IN+/IN-/OUT only in the current simplified wrapper; supply pins are absent, so explicit powered-package fidelity requires schema/model reconciliation. No digital attach expected. |
| `opamp-lm324` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical IN+/IN-/OUT only in the current simplified wrapper; supply pins are absent, so explicit powered-package fidelity requires schema/model reconciliation. No digital attach expected. |
| `opamp-lm358` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical IN+/IN-/OUT only in the current simplified wrapper; supply pins are absent, so explicit powered-package fidelity requires schema/model reconciliation. No digital attach expected. |
| `opamp-lm741` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical IN+/IN-/OUT only in the current simplified wrapper; supply pins are absent, so explicit powered-package fidelity requires schema/model reconciliation. No digital attach expected. |
| `opamp-tl072` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical IN+/IN-/OUT only in the current simplified wrapper; supply pins are absent, so explicit powered-package fidelity requires schema/model reconciliation. No digital attach expected. |
| `opto-4n25` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical AN/CAT/COL/EMIT; verify package pinInfo. No digital attach expected. |
| `opto-pc817` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical AN/CAT/COL/EMIT; verify package pinInfo. No digital attach expected. |
| `power-supply` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical +/−; verify package pinInfo. No digital attach expected. |
| `reg-7805` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical VIN/GND/VOUT (LM317 uses ADJ instead of GND); verify package pinInfo. No digital attach expected. |
| `reg-7812` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical VIN/GND/VOUT (LM317 uses ADJ instead of GND); verify package pinInfo. No digital attach expected. |
| `reg-7905` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical VIN/GND/VOUT (LM317 uses ADJ instead of GND); verify package pinInfo. No digital attach expected. |
| `reg-lm317` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical VIN/GND/VOUT (LM317 uses ADJ instead of GND); verify package pinInfo. No digital attach expected. |
| `signal-generator` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model; actual wrapper SIG/GND, not battery +/−. Backend schema/local analog whitelist/live bridge missing; no digital attach expected. |
| `source-ac-voltage` | A | No part-registry entry | +, - | ELECTRICAL: existing local validated separate schematic source/ground solver; no live MCU power binding. |
| `source-dc-current` | A | No part-registry entry | +, - | ELECTRICAL: existing local validated separate schematic source/ground solver; no live MCU power binding. |
| `source-dc-voltage` | A | No part-registry entry | +, - | ELECTRICAL: existing local validated separate schematic source/ground solver; no live MCU power binding. |
| `source-pulse-voltage` | A | No part-registry entry | +, - | ELECTRICAL: existing local validated separate schematic source/ground solver; no live MCU power binding. |
| `source-pwl-voltage` | A | No part-registry entry | +, - | ELECTRICAL: existing local validated separate schematic source/ground solver; no live MCU power binding. |
| `source-sine-voltage` | A | No part-registry entry | +, - | ELECTRICAL: existing local validated separate schematic source/ground solver; no live MCU power binding. |
| `zener-1n4733` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical A/C; verify package pinInfo. No digital attach expected. |

### boards — 12 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `arduino-mega` | B | No part-registry entry | 85 board pins; PIN_LAYOUTS | AVR: existing board engine; admitted parts have separate scope, I2C only Uno. |
| `arduino-nano` | B | No part-registry entry | 36 board pins; PIN_LAYOUTS | AVR: existing board engine; admitted parts have separate scope, I2C only Uno. Installed element: 12,11,10,9,8,7,6,5,4,3,2,GND.2,RESET.2,0,1,13,3.3V,AREF,A0,A1,A2,A3,A4,A5,A6,A7,5V,RESET,GND.1,VIN,12.2,5V.2,13.2,11.2,RESET.3,GND.3. |
| `arduino-uno` | B | No part-registry entry | 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, A0, A1, A2, A3, A4, A5, GND.1, GND.2, GND.3, 5V, 3.3V, VIN, AREF, RESET, IOREF, A4.2, A5.2 | AVR: existing board engine; admitted parts have separate scope, I2C only Uno. Installed element: A5.2,A4.2,AREF,GND.1,13,12,11,10,9,8,7,6,5,4,3,2,1,0,IOREF,RESET,3.3V,5V,GND.2,GND.3,VIN,A0,A1,A2,A3,A4,A5. |
| `esp32-c3` | B | No part-registry entry | 30 board pins; PIN_LAYOUTS | REMOTE: experimental browser RV32IMC/ROM exists but backend says unavailable/QEMU; Arduino firmware not certified, no adapter admission. |
| `esp32-devkit-c-v4` | B | No part-registry entry | 38 board pins; PIN_LAYOUTS | REMOTE: native QEMU/guest/deployment missing; compile/placement not execution. |
| `esp32-devkit-v1` | B | No part-registry entry | 30 board pins; PIN_LAYOUTS | REMOTE: native QEMU/guest/deployment missing; compile/placement not execution. Installed element: VIN,GND.2,D13,D12,D14,D27,D26,D25,D33,D32,D35,D34,VN,VP,EN,3V3,GND.1,D15,D2,D4,RX2,TX2,D5,D18,D19,D21,RX0,TX0,D22,D23. |
| `esp32-s3` | B | No part-registry entry | 44 board pins; PIN_LAYOUTS | REMOTE: native QEMU/guest/deployment missing; compile/placement not execution. |
| `pi-pico` | B | No part-registry entry | 40 board pins; PIN_LAYOUTS | RP: existing external GPIO/UART/ADC; Pico/Pico W pot scope only; wireless/second core absent. |
| `pi-pico-w` | B | No part-registry entry | 40 board pins; PIN_LAYOUTS | RP: existing external GPIO/UART/ADC; Pico/Pico W pot scope only; wireless/second core absent. |
| `raspberry-pi-3` | B | PartSimulationRegistry.ts | 31 board pins; PIN_LAYOUTS | REMOTE: native QEMU/guest/deployment missing; compile/placement not execution. Registry callback only forwards remote GPIO, not Pi emulator. |
| `raspberry-pi-4` | B | No part-registry entry | 31 board pins; PIN_LAYOUTS | REMOTE: native QEMU/guest/deployment missing; compile/placement not execution. |
| `raspberry-pi-5` | B | No part-registry entry | 31 board pins; PIN_LAYOUTS | REMOTE: native QEMU/guest/deployment missing; compile/placement not execution. |

### displays — 15 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `epaper-1in54-bw` | R/P | EPaperPart.ts | ∅ | SPI: GND/VCC/SCK/SDI/CS/DC/RST/BUSY; existing SSD168x mono decoder/framebuffer; ePaper not imported; BUSY polarity/refresh/reset/net outputs needed, no WASM gap. |
| `epaper-2in13-bw` | R/P | EPaperPart.ts | ∅ | SPI: GND/VCC/SCK/SDI/CS/DC/RST/BUSY; existing SSD168x mono decoder/framebuffer; ePaper not imported; BUSY polarity/refresh/reset/net outputs needed, no WASM gap. |
| `epaper-2in13-bwr` | R/P | EPaperPart.ts | ∅ | SPI: GND/VCC/SCK/SDI/CS/DC/RST/BUSY; existing SSD168x B/W/red decoder/framebuffer; ePaper not imported; BUSY polarity/refresh/reset/net outputs needed, no WASM gap. |
| `epaper-2in9-bw` | R/P | EPaperPart.ts | ∅ | SPI: GND/VCC/SCK/SDI/CS/DC/RST/BUSY; existing SSD168x mono decoder/framebuffer; ePaper not imported; BUSY polarity/refresh/reset/net outputs needed, no WASM gap. |
| `epaper-2in9-bwr` | R/P | EPaperPart.ts | ∅ | SPI: GND/VCC/SCK/SDI/CS/DC/RST/BUSY; existing SSD168x B/W/red decoder/framebuffer; ePaper not imported; BUSY polarity/refresh/reset/net outputs needed, no WASM gap. |
| `epaper-4in2-bw` | R/P | EPaperPart.ts | ∅ | SPI: GND/VCC/SCK/SDI/CS/DC/RST/BUSY; existing SSD168x mono decoder/framebuffer; ePaper not imported; BUSY polarity/refresh/reset/net outputs needed, no WASM gap. |
| `epaper-5in65-7c` | R/P | EPaperPart.ts | ∅ | SPI: GND/VCC/SCK/SDI/CS/DC/RST/BUSY; existing UC8159c7-colour decoder/framebuffer; ePaper not imported; BUSY polarity/refresh/reset/net outputs needed, no WASM gap. |
| `epaper-7in5-bw` | R/P | EPaperPart.ts | ∅ | SPI: GND/VCC/SCK/SDI/CS/DC/RST/BUSY; existing UC8179mono decoder/framebuffer; ePaper not imported; BUSY polarity/refresh/reset/net outputs needed, no WASM gap. |
| `ili9341` | R/P | ComplexParts.ts | ∅ | SPI: VCC/GND/CS/RST/D/C/MOSI/SCK/LED/MISO; existing write-only TFT/framebuffer, DC/reset/canvas binding; no display WASM gap. Installed element: VCC,GND,CS,RST,D/C,MOSI,SCK,LED,MISO. |
| `lcd1602` | R/P | ComplexParts.ts | ∅ | GPIO-OUT: parallel VSS/VDD/V0/RS/RW/E/D0-D7/A/K;4-bit HD44780 RS/E/D4-D7; dynamic pins/power/RW/backlight checks. Installed element: GND,VCC,SDA,SCL,VSS,VDD,V0,RS,RW,E,D0,D1,D2,D3,D4,D5,D6,D7,A,K. |
| `lcd1602-i2c` | I | ProtocolParts.ts | GND, VCC, SDA, SCL | I2C: VCC/GND/SDA/SCL; VirtualPCF8574 plus HD44780 16x2, default0x27. |
| `lcd2004` | R/P | ComplexParts.ts | ∅ | GPIO-OUT: parallel LCD1602 contract,20x4 HD44780; separate from admitted I2C ID; dynamic pins/power checks. |
| `lcd2004-i2c` | I | ProtocolParts.ts | GND, VCC, SDA, SCL | I2C: VCC/GND/SDA/SCL; VirtualPCF8574 plus HD44780 20x4, default0x27. |
| `ssd1306` | I | ProtocolParts.ts | DATA, CLK, DC, RST, CS, 3V3, VIN, GND | I2C: DATA=A4/CLK=A5,VIN5V/3V3 or 3V3 rail/GND. Original framebuffer; SPI or connected CS refused. Installed element: DATA,CLK,DC,RST,CS,3V3,VIN,GND. |
| `ssd1306-i2c-4pin` | I | ProtocolParts.ts | GND, VCC, SCL, SDA | I2C: SDA=A4/SCL=A5,VCC5V/3V3/GND; original SSD1306 target/framebuffer/address checks. |

### electromech — 2 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `motor-driver-l293d` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical VCC1/VCC2/GND/EN/IN/OUT; verify package pinInfo. No digital attach expected. |
| `relay` | S/P | No part-registry entry; SPICE emitter | ∅ | ELECTRICAL: existing exact SPICE model, backend schema/local whitelist/live bridge missing; physical COIL+/COIL-/COM/NO/NC; verify package pinInfo. No digital attach expected. |

### input — 6 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `dip-switch-8` | R/P | BasicParts.ts | ∅ | GPIO-IN: lowercase1a-8a/1b-8b; original A-side level writes ignore B wiring; values array events/contact validation needed. Installed element: 1a,2a,3a,4a,5a,6a,7a,8a,8b,7b,6b,5b,4b,3b,2b,1b. |
| `ky-040` | R/P | BasicParts.ts | ∅ | GPIO-IN: CLK/DT/SW/VCC/GND; rotation/button events use nested1ms timeouts not cancelled by cleanup; Basic not imported. Installed element: CLK,DT,SW,VCC,GND. |
| `membrane-keypad` | R/P | BasicParts.ts | ∅ | LINE: dynamic R1-R4/C1-C3 or C4; guest matrix model, held keys/ownership; Basic not imported. Installed element: R1,R2,R3,R4,C1,C2,C3,C4. |
| `potentiometer` | I | ComplexParts.ts; SPICE emitter | GND, SIG, VCC | POT: SIG to ADC, AVR5V/GND or Pico3V3/GND; rotary value0-1023; enabled AVR/Pico. Nano A6/A7 analog only. Installed element: GND,SIG,VCC. |
| `pushbutton` | L | BasicParts.ts; SPICE emitter | 1.l, 1.r, 2.l, 2.r | GPIO-IN: local rail-aware contact-bank input honors high-impedance/pulls; do not replace with upstream forced HIGH/active-low seeding. Installed element: 1.l,2.l,1.r,2.r. |
| `slide-switch` | R/P | BasicParts.ts; SPICE emitter | ∅ | GPIO-IN: common2, throws1/3; original change/input ignores throw wiring; validate contacts/rails/pulls; Basic not imported. Installed element: 1,2,3. |

### logic — 25 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `flip-flop-d` | R/P | LogicGateParts.ts | ∅ | NET: D/CLK ->Q/Qbar rising-edge model; no SPICE, virtual nets/initialization/edge ordering. |
| `flip-flop-jk` | R/P | LogicGateParts.ts | ∅ | NET: J/K/CLK ->Q/Qbar rising-edge model; no SPICE, virtual nets/initialization/edge ordering. |
| `flip-flop-t` | R/P | LogicGateParts.ts | ∅ | NET: T/CLK ->Q/Qbar rising-edge model; no SPICE, virtual nets/initialization/edge ordering. |
| `ic-74hc00` | E/P | No part-registry entry | ∅ | NET:14-pin VCC/GND/per-gate package; no exact registry/SPICE; existing digitalGateEngine/controller and visuals require binding. |
| `ic-74hc02` | E/P | No part-registry entry | ∅ | NET:14-pin VCC/GND/per-gate package; no exact registry/SPICE; existing digitalGateEngine/controller and visuals require binding. |
| `ic-74hc04` | E/P | No part-registry entry | ∅ | NET:14-pin VCC/GND/per-gate package; no exact registry/SPICE; existing digitalGateEngine/controller and visuals require binding. |
| `ic-74hc08` | E/P | No part-registry entry | ∅ | NET:14-pin VCC/GND/per-gate package; no exact registry/SPICE; existing digitalGateEngine/controller and visuals require binding. |
| `ic-74hc14` | E/P | No part-registry entry | ∅ | NET:14-pin VCC/GND/per-gate package; no exact registry/SPICE; existing digitalGateEngine/controller and visuals require binding. |
| `ic-74hc32` | E/P | No part-registry entry | ∅ | NET:14-pin VCC/GND/per-gate package; no exact registry/SPICE; existing digitalGateEngine/controller and visuals require binding. |
| `ic-74hc86` | E/P | No part-registry entry | ∅ | NET:14-pin VCC/GND/per-gate package; no exact registry/SPICE; existing digitalGateEngine/controller and visuals require binding. |
| `logic-gate-and` | R/P | LogicGateParts.ts; SPICE emitter | ∅ | NET: A/B ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-and-3` | R/P | LogicGateParts.ts | ∅ | NET: A/B/C ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-and-4` | R/P | LogicGateParts.ts | ∅ | NET: A/B/C/D ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-nand` | R/P | LogicGateParts.ts; SPICE emitter | ∅ | NET: A/B ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-nand-3` | R/P | LogicGateParts.ts | ∅ | NET: A/B/C ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-nand-4` | R/P | LogicGateParts.ts | ∅ | NET: A/B/C/D ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-nor` | R/P | LogicGateParts.ts; SPICE emitter | ∅ | NET: A/B ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-nor-3` | R/P | LogicGateParts.ts | ∅ | NET: A/B/C ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-nor-4` | R/P | LogicGateParts.ts | ∅ | NET: A/B/C/D ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-not` | R/P | LogicGateParts.ts; SPICE emitter | ∅ | NET: A ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-or` | R/P | LogicGateParts.ts; SPICE emitter | ∅ | NET: A/B ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-or-3` | R/P | LogicGateParts.ts | ∅ | NET: A/B/C ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-or-4` | R/P | LogicGateParts.ts | ∅ | NET: A/B/C/D ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-xnor` | R/P | LogicGateParts.ts; SPICE emitter | ∅ | NET: A/B ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |
| `logic-gate-xor` | R/P | LogicGateParts.ts; SPICE emitter | ∅ | NET: A/B ->Y boolean handler; Logic not imported, virtual nets/thresholds/ownership needed. |

### motors — 4 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `a4988` | R/P | MotorDriverParts.ts | ∅ | NET: STEP/DIR/ENABLE/MS1-MS3,RESET/SLEEP,VDD/GND/VMOT,1A/1B/2A/2B; rotates motor DOM via store wires/getElementById; app elements lack assigned ID; power/lookup bridge. |
| `biaxial-stepper` | R/P | BasicParts.ts | ∅ | NET: dual eight coil pins/hand-angle decoder; driver-derived nets, no load/current model. Installed element: A1-,A1+,B1+,B1-,A2-,A2+,B2+,B2-. |
| `servo` | I | ComplexParts.ts | GND, V+, PWM | GPIO-OUT: V+=5V/GND/PWM GPIO; guest pulse-width angle decoder, AVR only; unwired fallback refused; no torque/current. Installed element: GND,V+,PWM. |
| `stepper-motor` | R/P | SensorParts.ts | ∅ | NET: A-/A+/B+/B- field-angle decoder; driver nets/A4988 route needed; direct MCU coil drive unsafe, no torque/current. Installed element: A-,A+,B+,B-. |

### other — 18 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `7segment` | R/P | ChipParts.ts | ∅ | Dynamic A-G/DP/COM.1/COM.2 or digit/CLN pins; direct/multiplexed and shift-register modes; Chip import, common-return validation and store/DOM output lookup required. Installed element: A,B,C,D,E,F,G,DP,DIG1,DIG2,DIG3,DIG4,COM,CLN,COM.1,COM.2. |
| `analog-joystick` | R/P | ComplexParts.ts | ∅ | ADC+GPIO-IN: VERT/HORZ ADC/SEL button with VCC/GND; DOM direction -1/0/+1 differs from xAxis/yAxis dispatcher; match movement/button events. Installed element: VCC,VERT,HORZ,SEL,GND. |
| `big-sound-sensor` | R/P | SensorParts.ts | ∅ | ADC: AOUT,VCC/GND; soundLevel ->0-5V/default2.5V; DOUT indicator only, no microphone/comparator; add input descriptor. Installed element: AOUT,GND,VCC,DOUT. |
| `ds1307` | I | ProtocolParts.ts | GND, 5V, SDA, SCL, SQW | I2C: 5V pin to Uno5V/GND/SDA/SCL; Wasm/VirtualDS1307 fixed0x68, SQW/full features not certified; address collision. Installed element: GND,5V,SDA,SCL,SQW. |
| `ds3231` | I | ProtocolParts.ts | GND, VCC, SDA, SCL | I2C: VCC/GND/SDA/SCL; Wasm/VirtualDS3231 fixed0x68,temperature; alarm/SQW pins absent; collision. |
| `flame-sensor` | R/P | SensorParts.ts | ∅ | ADC: AOUT,VCC/GND; intensity ->5-0V panel, DOM input opposite; DOUT indicator only; add control/path consistency. Installed element: VCC,GND,DOUT,AOUT. |
| `gas-sensor` | R/P | SensorParts.ts | ∅ | ADC: AOUT,VCC/GND; gasLevel0-1023 ->0-5V/default100; DOUT indicator only; add control/saved initialization. Installed element: AOUT,DOUT,GND,VCC. |
| `hx711` | R/P | ProtocolParts.ts | ∅ | GPIO-IN: physical DT but handler resolves DOUT/SCK; DT alias required.24-bit fixed sample/readiness timeout, not full load-cell model. Installed element: VCC,DT,SCK,GND. |
| `ks2e-m-dc5` | G/P | SensorParts.ts | ∅ | NET: callback only logs COIL1/COIL2; no contacts/attachEvents/SPICE; insufficient relay model. Installed element: NO2,NC2,P2,COIL2,NO1,NC1,P1,COIL1. |
| `led-ring` | R/P | SensorParts.ts | ∅ | PIXEL: VCC/GND/DIN/DOUT; shared decoder/setPixel, pins/store-isolated lifecycle needed. Installed element: GND,VCC,DIN,DOUT. |
| `microsd-card` | R/P | ProtocolParts.ts | ∅ | SPI: SCK/DI/DO/CS,VCC/GND; SdSpiCard browser model,FAT image/readback reader, portable microsd WASM present; SPI fabric/storage lifecycle required. Installed element: CD,DO,GND,SCK,VCC,DI,CS. |
| `nano-rp2040-connect` | G/P | No part-registry entry | ∅ | RP: mis-categorized other board; no board configuration, extra peripherals/radio not implied by RP2040 CPU. Installed element: D12,D11,D10,D9,D8,D7,D6,D5,D4,D3,D2,GND.1,RESET,RX,TX,D13,3.3V,AREF,A0,A1,A2,A3,A4,A5,A6,A7,5V,RESET.2,GND.2,VIN. |
| `neopixel-matrix` | R/P | SensorParts.ts | ∅ | PIXEL: VCC/GND/DIN/DOUT; shared decoder/setPixel/rows/cols, pins/store lifecycle needed. Installed element: GND,VCC,DIN,DOUT. |
| `pushbutton-6mm` | L/P | BasicParts.ts | ∅ | GPIO-IN: local branch exists but backend pins empty; complete 1.l/1.r/2.l/2.r schema before API wiring. Installed element: 1.l,2.l,1.r,2.r. |
| `rotary-dialer` | R/P | BasicParts.ts | ∅ | GPIO-IN: GND/DIAL/PULSE; nested digit-pulse timeouts not cancelled, defer safe teardown; Basic not imported. Installed element: GND,DIAL,PULSE. |
| `slide-potentiometer` | I | ComplexParts.ts; SPICE emitter | VCC, SIG, GND | POT: SIG/OUT ADC; min/max/value normalization. AVR/Pico code allows, catalog advertises Uno only; Pico slider firmware scope not certified. Installed element: VCC,SIG,GND. |
| `small-sound-sensor` | R/P | SensorParts.ts | ∅ | ADC: AOUT,VCC/GND; soundLevel ->0-5V/default2.5V; DOUT indicator only, no microphone/comparator; add input descriptor. Installed element: AOUT,GND,VCC,DOUT. |
| `tilt-switch` | R/P | SensorParts.ts | ∅ | GPIO-IN: OUT,VCC/GND; click/toggle=true; starts upright regardless saved state; add action/state/reset policy. Installed element: GND,VCC,OUT. |

### output — 5 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `buzzer` | R | ComplexParts.ts | 1, 2 | GPIO-OUT: signal1/return2; existing digital/PWM/Timer2 frequency and AudioContext, loaded/unselected. Return/gesture/teardown gates, start Uno. Installed element: 1,2. |
| `led` | L | BasicParts.ts; SPICE emitter | A, C | GPIO-OUT: local A HIGH/C LOW continuity via generic resistor; upstream Basic also reads electrical current/burnout store, not this local behavior. Installed element: A,C. |
| `led-bar-graph` | R/P | BasicParts.ts | ∅ | GPIO-OUT: A1-A10/C1-C10; original observes anodes only; validate cathodes/resistors, import Basic, capture values. Installed element: A1,A2,A3,A4,A5,A6,A7,A8,A9,A10,C1,C2,C3,C4,C5,C6,C7,C8,C9,C10. |
| `neopixel` | R | SensorParts.ts | VDD, VSS, DIN, DOUT | PIXEL: VDD/VSS/DIN/DOUT; loaded/unselected original decoder; power/timing/store lifecycle/chain route needed. Installed element: VDD,DOUT,VSS,DIN. |
| `rgb-led` | I | ComplexParts.ts | R, G, B, COM | GPIO-OUT: COM=GND, R/G/B GPIO, series resistor each; common-cathode digital/PWM AVR only, no current/common-anode/Pico model admission. Installed element: R,COM,G,B. |

### passive — 37 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `breadboard` | T/P | No part-registry entry | ∅ | TOPOLOGY: strip/rail pinInfo; backend labels absent and local LED/button strips not routed; no attachEvents needed. |
| `breadboard-mini` | T/P | No part-registry entry | ∅ | TOPOLOGY: mini strip pinInfo; backend labels absent; existing upstream topology, not attachEvents. |
| `cap-100n` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-100p` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-10n` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-10p` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-1n` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-1u` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-22p` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-elec-1000u` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; polarized +/− terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-elec-100u` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; polarized +/− terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-elec-10u` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; polarized +/− terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-elec-1u` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; polarized +/− terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-elec-470u` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; polarized +/− terminals, preserve catalog value; local analogPins excludes preset. |
| `cap-elec-47u` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; polarized +/− terminals, preserve catalog value; local analogPins excludes preset. |
| `capacitor` | A | No part-registry entry; SPICE emitter | 1, 2 | PASSIVE: existing separate local generic ngspice model, no live MCU feedback. |
| `capacitor-electrolytic` | A/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: local legacy +/− Unicode minus analog path exists, backend pins empty; schema wiring blocker, no live MCU feedback. |
| `franzininho` | G/P | No part-registry entry | ∅ | AVR: mis-categorized passive board; no admitted board/compiler/runtime/part model. Installed element: GND.1,VCC.1,PB4,PB5,PB3,PB2,PB1,PB0,VIN,GND.2,VCC.2. |
| `ind-100u` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `ind-10m` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `ind-1m` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `inductor` | A | No part-registry entry; SPICE emitter | 1, 2 | PASSIVE: existing separate local generic ngspice model, no live MCU feedback. |
| `ir-receiver` | R/P | ProtocolParts.ts | ∅ | LINE: DAT with VCC/GND, OUT/DATA aliases; irAir + guest ir-nec model/address/command/channel/lease. Installed element: GND,VCC,DAT. |
| `ir-remote` | R | ProtocolParts.ts | ∅ | LINE: intentionally wireless/pinless NEC irAir broadcast; needs receiver same channel/line host. |
| `junction` | T/P | No part-registry entry | ∅ | TOPOLOGY: single node pin; expose exact label/shared net identity. |
| `resistor` | A | No part-registry entry; SPICE emitter | 1, 2 | PASSIVE: existing separate local generic ngspice model, no live MCU feedback. Also digital continuity hop, not current computation. Installed element: 1,2. |
| `resistor-100k` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-10k` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-1k` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-1m` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-220` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-22k` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-2k2` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-330` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-470` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-47k` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |
| `resistor-4k7` | S/P | No part-registry entry; SPICE emitter | ∅ | PASSIVE: exact preset ->base SPICE; 1/2 terminals, preserve catalog value; local analogPins excludes preset. |

### sensor — 1 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `bmp280` | R/P | ProtocolParts.ts | ∅ | I2C: physical SDA/SCL/GND/VCC,0x76/0x77,Wasm/VirtualBMP280; temperature/pressure/sleep controls. WASM present; pins/admission missing. |

### sensors — 9 IDs

| ID | Status | Actual registry / electrical source | Backend pins | Physical pins / behavior / dependency profile |
|---|---|---|---|---|
| `dht22` | I | ProtocolParts.ts | VCC, SDA, NC, GND | LINE: VCC5V/GND/SDA or DATA GPIO, NC unused; timed temperature/humidity, AVR only. Installed element: VCC,SDA,NC,GND. |
| `gps-neo6m` | R/P | GpsParts.ts | ∅ | UART: VCC/GND/TX/RX wrapper, TX-only NMEA9600 guest clock; lat/lng/altitude/speed; GPS import/UART fabric missing. |
| `hc-sr04` | I | SensorParts.ts | VCC, TRIG, ECHO, GND | LINE: VCC5V/GND/distinct TRIG/ECHO; guest echo/distance model, AVR only; queued echoes require stop on detach. Installed element: VCC,TRIG,ECHO,GND. |
| `heart-beat-sensor` | R/P | SensorParts.ts | ∅ | ADC+GPIO-IN: OUT,VCC/GND; guestMillis PPG/digital beat,20ms interval,bpm30-220; shared-pad ownership/ADC reset tests. Installed element: GND,VCC,OUT. |
| `mpu6050` | I | ProtocolParts.ts | INT, AD0, XCL, XDA, SDA, SCL, GND, VCC | I2C: Wasm/VirtualMPU6050,0x68/0x69,AD0/optionalINT; XCL/XDA not certified, motion descriptors sparse, RTC collision. Installed element: INT,AD0,XCL,XDA,SDA,SCL,GND,VCC. |
| `ntc-temperature-sensor` | I | SensorParts.ts; SPICE emitter | GND, VCC, OUT | ADC: VCC/GND/OUT; beta3950/10k divider, saved temperature/default25C; add temperature descriptor. Installed element: GND,VCC,OUT. |
| `photodiode` | S/P | SensorParts.ts; SPICE emitter | ∅ | ELECTRICAL: A/C reverse diode plus lux photocurrent SPICE; Sensor handler forwards lux only, not ADC injection. |
| `photoresistor-sensor` | I | ComplexParts.ts; SPICE emitter | VCC, GND, DO, AO | ADC: AO, VCC/GND; lux0-1000 ->0-5V; DO only observed for LED, no comparator output; add lux control, SPICE divider distinct. Installed element: VCC,GND,DO,AO. |
| `pir-motion-sensor` | I | SensorParts.ts | VCC, OUT, GND | GPIO-IN: OUT,VCC/GND; click/trigger=true ->3s wall-time HIGH, timer cancellation exists; add action/input reset. Installed element: VCC,OUT,GND. |



## Registry-only IDs — all five, outside the 172

| ID | Existing source/model | Required dependency / gap |
|---|---|---|
| `74hc595` | Chip: real shift/latch/OE/MR/Q-output behavior | Absent backend catalog ID/pins; add catalog/visual contract and Chip import, real/virtual output nets and store/DOM lookup bridge. Uses upstream wires and document.getElementById for connected outputs. |
| `custom-chip` | CustomChipPart/ChipInstance | Absent backend catalog ID; requires its own project wasmBase64, chipJson, dynamic pins/attrs, optional ROM, guest clock/pad/bus bridges. No compiled chip bytes means intentionally skipped behavior. |
| `ili9341-cap-touch` | Complex: alias to ILI9341 display handler | Absent backend catalog ID/pins; SPI profile. Alias covers display, not proof of touch-controller behavior. |
| `lcd2002` | Complex: 20×2 HD44780 decoder | Absent backend catalog ID/pins; parallel LCD contract and lifecycle. |
| `pcf8574` | Protocol: VirtualPCF8574 I2C target | Absent standalone backend catalog ID/pins; I2C + NET profiles, address/port-state/latch routing. Already used internally by I2C LCD backpacks; not standalone expander integration. |

## WASM and missing model distinction

**All five fixed bus WASMs are present** in app and vendor public bus-chips trees: bmp280.wasm, ds1307.wasm, ds3231.wasm, mpu6050.wasm, microsd.wasm. Their C/chip-json sources and i2cModelBytes.generated.ts are present under simulation/buses/models. Four I2C handlers prefer compiled Wasm models with VirtualBMP280/VirtualDS1307/VirtualDS3231/VirtualMPU6050 fallbacks if unavailable/disabled. BMP280 is therefore blocked by pins, controls and admission—not missing WASM. Browser microSD uses the existing SdSpiCard; portable WASM serves worker-hosted responders, not missing local SPI bindings.

OLED/LCD/TFT/ePaper, ADC sensors, switches, servo, NeoPixels, keypad and IR have existing JS/TS/line models; they need no invented WASM chip. Generic custom-chip is different: it requires project-specific compiled bytes and chip JSON. No arbitrary app public/chips precompiled chip catalog exists at the checked roots. The five fixed bus binaries cannot stand in for arbitrary chip firmware.

Actual model gaps:

- **ks2e-m-dc5:** registered callback only logs COIL1/COIL2; no implemented relay contact propagation, attachEvents or SPICE emitter.
- **ic-74hc00, ic-74hc02, ic-74hc04, ic-74hc08, ic-74hc14, ic-74hc32, ic-74hc86:** no exact PartSimulationRegistry entry/SPICE emitter. Visual packages and existing upstream digitalGateEngine/controller exist; binding that existing engine is the reuse route, not evidence of current app coverage. Do not silently substitute generic gate IDs for powered 14-pin packages.
- **franzininho, nano-rp2040-connect:** no admitted board/compiler/runtime configuration or sufficient part handler. Mis-categorized passive/other board visuals are not R/L/C or peripheral models.
- **custom-chip:** registry-only, needs its own missing project artifact/catalog integration. ili9341-cap-touch only establishes display alias behavior, not touch support.
- Native ESP/Linux board requirements are deployment/guest/bridge gaps. ESP32-C3 has an experimental browser core while backend catalog still advertises unavailable/QEMU; do not report certified Arduino execution.
- Missing registry entries for semiconductors, batteries, relays/L293D and R/L/C presets are generally expected electrical/topological coverage, not missing attachEvents. Photodiode's handler forwards lux only; its actual photocurrent behavior is SPICE.

## Safe next integrated batches — recommendations, not implementation

### Batch 1: Uno-only active sensors/sliders, switches and outputs

Safest reuse candidates: **ntc-temperature-sensor, photoresistor-sensor analog channel, analog-joystick, pir-motion-sensor, tilt-switch**, followed by **gas-sensor, flame-sensor, big-sound-sensor, small-sound-sensor** analog-only controls, and **slide-switch, led-bar-graph, buzzer**. Original handlers already exist; most candidates need exact backend pins and honest controls first. There is no justification for a new CPU/peripheral physics engine for these scoped behaviors.

- NTC: expose temperature slider and GND/VCC/OUT, reuse the existing 3950-beta 10k-divider ADC model; initialize from project temperature.
- Photoresistor: expose lux and VCC/GND/AO/DO. Scope to original Uno analog injection only; DO handler observes GPIO for LED, does not create a comparator output. Existing SPICE divider is a distinct physical model from the simple linear injection.
- Joystick: physical VERT/HORZ/SEL, two ADCs plus button GPIO. DOM xValue/yValue are -1/0/+1, while sensor dispatcher uses xAxis/yAxis ranges; match paths and synthesize required motion/button events.
- PIR/tilt: physical OUT with VCC/GND, discrete trigger/toggle actions rather than ordinary numeric property edits; PIR uses an existing 3-second browser timeout and cancels it, not an acoustic/environment model.
- Gas/flame/sound: add gasLevel/intensity/soundLevel descriptors (metadata currently often exposes only LEDs), 5V power and AOUT/DOUT. Match original defaults and saved state. DOUT is indicator observation only; don't advertise a nonexistent threshold comparator. Flame DOM input mapping differs from its panel mapping; reconcile before admission.
- Slide switch: pin 2 common, 1/3 throws to explicit GND/rail; original handler uses value as level and ignores throws. Validate real wiring/pulls/drive direction instead of replacing hardware with a click-to-GPIO shortcut.
- Bar graph: A1–A10/C1–C10; original handler observes anodes only. Validate each cathode return and current-limiting resistor, capture values, import BasicParts.
- Buzzer: legal backend 1/2 pins already exist and Complex handler is loaded but unselected. Validate signal/return, AudioContext user-gesture behavior, tone/PWM timing and teardown; start Uno.
- DIP switch is a subsequent bounded batch: lowercase 1a–8a/1b–8b, values array events/update bridge and B-side contact validation are required. Heartbeat follows after guest-clock/analog-GPIO ownership/ADC reset tests. Pushbutton-6mm is completion of a local branch's missing pin schema, not a new model.
- Rotary/slide potentiometers are already admitted. Remaining slider work is verification/catalog scope consistency: code permits AVR/Pico, catalog advertises slide Uno only; Pico slider firmware behavior is not certified by this inventory.

Before any candidate is marked integrated: real compiled Uno firmware must change ADC/serial/GPIO readings with controls; wrong/unwired power/GND/signal, active crossing and output contention must refuse or diagnose; saved values/reset must agree; stop/removal/rewire must release seeded ADC/GPIO/timers/audio; the existing 13 parts and local LED/button behavior must not regress. Browser appearance alone is insufficient. These acceptance tests were not run here.

### Batch 2: existing scoped Uno I2C fabric

**bmp280** is the safest next bus target: model and WASM already exist. Add exact SDA/SCL/GND/VCC, temperature/pressure/address controls, 0x76/0x77 validation, selected admission and sleep/collision diagnostics to existing Uno I2C infrastructure. Later enrich MPU6050 controls and explicitly certify RTC feature subsets. Standalone PCF8574 needs catalog and actual peripheral-port routing, not merely the already integrated backpack decoder.

### Batch 3 and structural work

Parallel LCD1602/LCD2004, matrix keypad, IR pair and AVR NeoPixel are feasible reuse but require pin/protocol/lifecycle/line/store isolation tests. KY-040 and rotary dialer leave nested timeouts pending; defer until safe teardown and declared timing scope. HX711 needs physical DT versus resolved DOUT correction and honest fixed-sample limitations. A4988/stepper needs graph/DOM/virtual-net binding and motor-supply policy; direct MCU-to-coil wiring is not a hardware-safe integration.

ILI9341/all eight ePaper panels/microSD need scoped existing SPI fabric; GPS needs scoped UART fabric and serial conflict handling. Gate chains, flip-flops, powered 74HC packages, shift registers, driver outputs and expander ports need existing peripheral/virtual-net engines. Semiconductors/preset passives/relay contacts need broader use of the already present SPICE solver and, for live firmware interaction, its voltage/current/threshold bridges. Board deployment/runtime and arbitrary custom-chip artifacts remain separate prerequisites.

**Integrating all components cannot be done by expanding selected.** Full pins/controls, existing bus/peripheral/virtual-net engine bindings, scoped store/DOM bridges, electrical feedback, deployed board runtimes and chip artifacts are required. Reuse these existing engines; no new engine is proposed or implemented.

## Evidence paths

Repository-relative paths are used for portability.

- backend/hardware.py: ComponentCatalog expansion, PIN_LAYOUTS, descriptors, board scope and API pin validation.
- public/components-metadata.json and vendor/velxio/frontend/public/components-metadata.json: 157 metadata IDs/categories/defaults.
- src/hardware/velxioParts.ts, velxioBus.ts, runtime.ts, part.tsx: actual selection, rail/pin/board gates, bus binding, local behavior, lifecycle and DOM geometry.
- src/hardware/spice.ts and spice-netlist.js: separate analog whitelist and existing solver/netlist reuse.
- vendor/velxio/frontend/src/simulation/parts/{PartSimulationRegistry,index,ActiveParts,BasicParts,ComplexParts,SensorParts,ProtocolParts,ChipParts,GpsParts,MotorDriverParts,LogicGateParts,CustomChipPart,EPaperPart,partUtils,wasmI2cModels}.ts: original models and handler dependencies.
- vendor/velxio/frontend/src/simulation/spice/componentToSpice.ts and displays/EPaperPanels.ts: exact electrical emitters/preset aliases and all eight generated panel registrations.
- vendor/velxio/frontend/src/simulation/buses/{busChips,registry,storeResolver,i2cBus,spiBus,uartBus}.ts, buses/models, line/models, digital: existing infrastructure.
- node_modules/@wokwi/elements/dist/esm/*-element.js and vendor components/velxio-components wrappers: actual physical pin names, including HX711 DT mismatch.
- public/bus-chips and vendor frontend/public/bus-chips: five present fixed compiled assets.
- Existing scope evidence, not executed: tests/{uno-peripherals,avr-peripherals,slide-potentiometer,pico-analog,dht-runtime,rgb-runtime,oled-runtime,lcd-runtime,i2c-sensors,uno-lifecycle}.spec.ts and backend catalog tests.
