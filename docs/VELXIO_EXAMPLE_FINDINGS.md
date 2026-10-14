<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Velxio example corpus findings for Wireup

## Scope and evidence

This is a read-only, exhaustive static review of **all 321 exported records**, not a sample and not model retraining. The requested `analysis.json` does not exist under that exact name; the matching companion is `backend/templates/example-analysis.json`, with 321 records. Each raw record was individually iterated and joined to its companion by ID. The appendix lists every record.

- Export: `backend/templates/velxio-examples.json`; SHA-256 `648aee2c1e45c8a40e3d67c8f8a5c405eee678da0926d290bce4594afb48d17c`.
- Companion: `backend/templates/example-analysis.json`; SHA-256 `6016e2d91763fb6ae772151ca08af1f00966b0745162fa1110057753dd958249`.
- Both contain 321 unique IDs; their ID sets agree. The companion's export hash agrees with the current export. All 321 companion firmware hashes reproduce using the existing analyzer's source aggregation convention.
- Shell Python commands were bounded to 300,000 ms each. JSON parsing, counters, source regexes, explicit-wire union/find, and extraction of current board/pin constants were used. No compiler, simulation, network request, project creation, or backend mutation was run. The mutation-capable existing analyzer was read, not executed.
- Saved canonical outcomes below are **previously recorded evidence**, not validation rerun in this review. Board capability labels are configuration, not a live runtime probe.
- Only this permitted document was written. Pre-existing working-tree changes were observed in `backend/example_requirements.py`, `backend/templates/example-build-knowledge.json`, and `scripts/analyze-velxio-examples.py`; they were not edited by this review.

## Corpus counts

| Measure | Count |
|---|---:|
| Projects | 321 |
| Placed component instances, including explicitly placed boards | 1,709 |
| Wires / wire endpoints | 3,177 / 6,354 |
| Explicit `boards[]` instances | 54 in 46 projects |
| Multi-board projects | 8 |
| Files | 117 in 56 projects |
| Multi-file projects | 22 |
| Largest circuit | 57 parts, 112 wires: `digital-carry-lookahead-adder-4bit` |
| Largest source payload | 98,540 characters, 34 files: `robot-desktop-eyes` |

Categories: circuits 116; communication 68; basics 49; sensors 35; displays 33; robotics 12; motors 4; games 4. Difficulty: beginner 134; intermediate 124; advanced 63. Languages: default Arduino 270; MicroPython 50; ESP-IDF 1. The Arduino label is a default, not proof of source-language correctness: assembly/C custom-CPU examples also inherit it.

Saved classifications: blocked **282**, canonical candidate unverified **33**, selected starter **6**. Saved canonical outcomes: passed **64**, failed **257**. Of the 64 passes, **25 still have blockers**; passing endpoint/property/import validation is not full support. Every one of the 321 has `real_compile`, `browser_run`, and `electrical_safety` equal to `not_verified`.

Saved blocker counts count distinct affected projects per category, not blocker instances; categories overlap:

| Blocker | Projects |
|---|---:|
| Canonical validation gap | 257 |
| Unresolved pin layout | 184 |
| Runtime unavailable | 110 |
| Unsupported component | 85 |
| Dependency unverified | 53 |
| Unsupported language | 51 |
| Network/radio requirement | 39 |
| Unsupported source file | 34 |
| Unsupported board | 31 |
| Multi-file | 22 |
| Multi-board | 8 |

Normalized board mentions, counting each unique board kind per project, include Uno 149, ESP32 DevKit V1 65, Pico 25, STM32 Blue Pill 17, ESP32-C3 16, Pico W 13, Nano 5, Mega 5, ESP32-S3 5, and DevKit C V4 4. These are not instance totals: the three dual-Pico records each collapse two identical board kinds into one companion board entry.

## Metadata and source precedence

All records have ID, title, description, category, difficulty, components, and wires. Optional fields absent: `libraries` 280; `boards` 275; `languageMode` 270; `files` 265; `boardType` 183; `tags` 169; `boardFilter` 124. Absence alone is not a defect, but it makes inferred defaults unsafe as requirements.

**98 projects have empty/missing top-level code**, yet only **7 lack effective selected source**. Source precedence is essential: 56 use `files[]`; another 40 use `boards[].code`; the remaining 225 use top-level `code`. Five have both files and nonempty top-level code. Never index only `code`, silently concatenate independent board programs, or discard support files.

The seven empty effective-source records are `pi3-blink-led`, `pi3-running-lights`, `pi4-button-led`, `pi4-rgb-color-cycle`, `pi5-pir-motion-alarm`, `pi5-traffic-light`, and `galaksija-z80-computer`. The latter contains custom-chip/ROM payloads, so an empty Arduino sketch is not proof the project contains no executable behavior.

**76 analog/digital-filtered projects have no declared or placed MCU**, but the current `example_boards()` fallback reports Uno. They need boardless digital/SPICE/custom-chip routing, not a fabricated Uno or an Arduino compile requirement.

**13 projects contain 18 custom-chip instances**. Every instance carries `chipName`, `sourceC`, `chipJson`, and `wasmBase64`; some also carry ROM/program-target metadata. These are executable artifacts and pin schemas, not decorative properties. Preserve them as separately typed, hashed, untrusted artifacts; do not execute them merely to populate the retrieval corpus.

`robot-desktop-eyes` exceeds the current reference limits of 16 files and 30,000 source characters. It is the only record over either limit. No record exceeds 64 parts or 128 wires. The corpus should retain complete originals outside bounded model responses, with explicit truncation and retrievable file manifests.

## Pins, aliases, and topology

### Catalog coverage

The companion describes **298 unknown component instances across 14 types**, and **408 known instances across 50 types without pin layouts**. Missing-pin layouts affect 184 projects; unknown types affect 85. A catalog name or preview is not a usable endpoint schema.

Priority gaps by reuse: signal-generator 87 instances/72 projects; slide-switch 146/41; SSD1306 13/13; BJT 2N2222 15/11; custom-chip 18/13; unknown Velxio AND gate 82/24. Other unknowns include XOR/NAND/NOT/OR/NOR/XNOR, 3-/4-input gates, voltmeters, and ammeters. Resolve actual tag/model mappings and pins; blanket removal of `velxio-` is not a safe conversion.

The exhaustive endpoint scan found **1,944 endpoints on known parts lacking pin schemas**, and **1,225 on unknown parts**, using companion component identities and existing single-board alias semantics. These overlapping project populations cannot be added to obtain a unique project count.

### Board identity versus pin identity

**548 wire endpoints in 90 projects use a known board alias inconsistent with the selected board**, principally `arduino-uno` reused for Pico/ESP32 variants. This is an upstream naming/normalization hazard, not 90 proven broken circuits: `normalize_template()` currently rewrites all known board aliases to its single `board`. Keep an explicit original-instance-to-canonical-instance map and disclose adaptations; never let that convenience merge real multi-board instances.

After current alias resolution, **16 endpoints in 14 projects use pins absent from known current layouts**:

- `pico-blink`: GP25 is onboard-only, not an exposed Pico header. Its starter normalization already removes the external LED/resistor/wires while preserving firmware; preserve that adaptation provenance.
- Six Pico sensor examples: `3.3V` is not the layout's `3V3` label.
- `esp32-servo` and `esp32-doom`: `GND2` versus the supported `GND.2` label (three endpoints).
- Four C3 sensor examples: `3V3` versus `3V3.1`/`3V3.2`.
- `esp32s3-ili9341-hello`: two `3V3` endpoints versus `3V3.1`/`3V3.2`.

Alias fixes require physical board-specific confirmation; a label mismatch is not evidence of an electrical fault.

### Limited wire-net scan

Across all 321 records, explicit-wire checks found **0 duplicate component IDs, duplicate wire IDs, duplicate endpoint pairs, self-wires, or directly wire-connected distinct known board power/ground rails**. With current single-board alias normalization, the limited LED scan found **0 unwired LED terminals, shorted LED terminals, or direct board-to-LED-to-ground paths lacking an intervening part**.

However, **148 LEDs in 58 projects lack the simple board/resistor/LED/board path recognized by the limited checker**. Many are legitimately driven through gates, transistors, relays, or another board. This is an unverified topology class, not 148 missing resistors. Internal switch/bus/device connectivity, operating states, current, supply suitability, loading, and general electrical safety remain unchecked.

Seven completely unwired placed components are four board instances in serial/blink/SPI examples plus IR remotes in three IR examples. These are not automatically defects: onboard/serial behavior needs no external wire, and IR is a room/broadcast relationship. Preserve non-wire relationships explicitly.

## Actionable source/wiring structural mismatches

These are static discrepancies grounded in named source expressions and wire IDs, not observed runtime failures.

| Example | Source versus structure | Recommended treatment |
|---|---|---|
| `pico-hcsr04` | `TRIG_PIN=17`, `ECHO_PIN=18`; `pcs-trig` ends at board GP5 and `pcs-echo` at GP6. Description also confuses D5/D6 with GP17/GP18. | Require one documented mapping; reconcile firmware/wires to GP17/18 or intentionally change firmware to GP5/6. Review sensor supply/echo voltage separately. |
| `pico-pir` | Reads `PIR_PIN=16`; wire `pp-out` goes to GP4. | Reconcile signal to GP16 or change firmware and description together. |
| `pico-joystick` | Button `JOY_BTN=16`; `pj-sel` goes to GP4. A0/GP26 and A1/GP27 axes are correctly aliasable. | Fix only the button mismatch; do not flag correctly mapped analog aliases. |
| `logic-probe` | Claims three LEDs including yellow=floating; only green/red LEDs exist. Sets GPIO11 output but has no yellow LED; GPIO7 input has no test connection; firmware only handles HIGH/LOW. | Supply a probe input and third indicator plus a defensible floating-detection mechanism, or narrow the claim to binary HIGH/LOW. A bare digital read cannot establish floating. |
| `100d-smart-iot-gas-monitoring-system` | `main.py` reads MQ2 via ADC(Pin(34)) and soil via ADC(Pin(35)); only a DHT22 is placed/wired at GPIO4. | Record gas/soil channels as missing requirements, rather than pretending the DHT-only diagram implements them. Separate device, web-server, and analysis artifacts. |
| `robot-desktop-eyes` | `Common.h` and `Weather.h` select `DHTTYPE DHT11`; diagram places DHT22. `esp32-eyes.ino` line 134 sets `SOUND_PIN` OUTPUT while `SensorDriver.h` reads it and `s-snd` connects sensor DOUT to GPIO2. Speaker definitions also reuse GPIO2. Both servos take board 3V3. | Reconcile sensor model; make sensor input/output ownership explicit, separate speaker pin, and review real servo supply/current independently. Do not treat library installation as solving topology. |
| `spi-loopback` | `SPI.transfer()` reads responses, but there are no wires or slave. | Declare MOSI/MISO loopback wiring or a slave if loopback responses are the acceptance goal; otherwise label this transmit/protocol-only. |
| `multi-protocol` | SPI transfer and SS GPIO10 coexist with only RTC/EEPROM I2C wiring. | Preserve I2C behavior; label SPI response unverified/no slave rather than implying every protocol is structurally implemented. |

A broad literal/constant GPIO detector initially emitted many candidates, including false positives from loop variables, onboard LEDs, ATtiny PB aliases, Pico ADC aliases/internal temperature channels, and foreign-board placeholders. Those totals are **not defect counts**. The table above is the actionable evidence set after checking source and wires. In particular, `esp32-blink-led` correctly uses onboard GPIO2 and wired external GPIO4; absence of a GPIO2 external wire is not an error.

Two titles/descriptions mention DHT11 while placing DHT22: the DHT11 web-server example and the robot. The web-server source explicitly chooses `dht.DHT22(Pin(4))` with a real-hardware note, so it is a documented simulator adaptation; the robot's active DHT11 selection is the stronger mismatch. Nine DHT-bearing projects mention DHT11 somewhere in source, often in adaptation comments; do not count all nine as faults.

## Timing and behavioral claim pitfalls

- **One concrete timing-contract inconsistency:** `dual-pico-bidirectional-handshake` sender comments promise one-second toggles, but after an acknowledgement its 200 ms wait exits early and it delays only 800 ms. Period is approximately 800–1,000 ms plus execution overhead, depending on acknowledgement timing. The responder toggles and retains ACK state; it does not produce a fixed-width pulse as the description says. Use a fixed deadline/elapsed-time contract or change the wording to edge-toggle acknowledgement with variable period.
- **One explicitly documented simulator/hardware timing difference:** `epaper-5in65-7c-esp32-rainbow` says real refresh is about 12 seconds while emulated BUSY is 150 ms, about 80 times shorter. Retain separate timing expectations; emulator responsiveness is not physical refresh evidence.
- `stm32-uno-gpio-mirror` and `dual-pico-digital-mirror` each delay 500 ms HIGH and 500 ms LOW: 500 ms between transitions, a 1-second full period (1 Hz), not 2 Hz.
- `nano-serial` schedules output with `millis()-lastPrint >= 1000`; its `delay(200)` is setup-only. `serial-hello` emits uptime with `delay(2000)`. Scanning the first delay would give the wrong cadence.
- Three dual-Pico W projects rely on `LED_BUILTIN`; current Pico W configuration explicitly excludes the CYW43 onboard LED and radio. Source-level GPIO/serial behavior and LED observability are separate requirements.
- `pico-hcsr04` bounds echo waiting with `pulseIn(...,30000UL)` and delays 500 ms between loops. This is static timeout evidence, not verified distance accuracy. Blocking waits, UART output, network I/O, scheduling and sampling add latency.

No exhaustive control-flow timing proof or live measurement was performed. The one timing-contract inconsistency count is the manually established finding after scanning all descriptions/sources, not a claim that every other project is temporally correct.

## Dependencies and example source API patterns

**41 projects declare libraries; none of those declarations pins a version.** The companion flags 53 projects for unverified dependencies. An additional explicit scan finds **12 projects without library declarations but with non-baseline headers**, including Servo, ESP-IDF driver/FreeRTOS, ESP32 WiFi/WebServer/BLE/camera, and SD. Some belong to board cores: header presence does not mean a Library Manager package is missing.

Frequent declared names: Adafruit GFX 23 projects; SSD1306 10; BusIO 9; Unified Sensor 7; GxEPD2 7; ILI9341 6; DHT 5; BMP280 3; ESP32Servo 3. Frequent headers: Wire.h 24, Adafruit_GFX.h 16, SPI.h 12, Adafruit_SSD1306.h 10. `esp32-blink-led` names Arduino-ESP32 2.0.17/IDF 4.4.x only in source comments: promote that into board-core requirements instead of losing it during indexing.

Complete Python import scanning, including comma-separated imports, finds machine 48 projects, time 45, network 28, socket 14, urequests 11, dht 8, BlynkLib 7, ssd1306 6, flask 4, pandas 1 and matplotlib.pyplot 1. The existing analyzer regex records only the first name in `import network, urequests, time, dht`; for example, it undercounts urequests as 7 rather than 11. Resolve imports against firmware builtins, shipped support files, device packages, and host-only dependencies separately. Four Flask projects mix or include host-server requirements; `100d-smart-iot-gas-monitoring-system` additionally ships pandas/matplotlib analysis. They cannot all run as MicroPython files on one MCU. `100d-iot-based-dsm-smart-metering` ships two policy modules, but main imports only the CSV variant: file presence does not mean both modes execute.

**20 projects contain literal credential/token assignment candidates** under a conservative static regex. Values are intentionally omitted here; these are not 20 proven live secrets. Redact corpus previews, parameterize configuration, and never connect automatically. Saved network/radio blockers cover 39 projects; no live connectivity is established.

Source API pattern counts below are projects containing a pattern after basic comment removal, not number of calls or resolved active control-flow paths:

| Pattern | Projects |
|---|---:|
| delay / millis / delayMicroseconds | 167 / 25 / 7 |
| Serial or SerialN begin | 163 |
| pinMode / digitalWrite / digitalRead | 93 / 80 / 32 |
| analogRead / analogWrite | 36 / 11 |
| Wire member calls / SPI member calls | 24 / 12 |
| pulseIn / tone | 4 / 1 |
| Servo-style `.attach()` | 5 |
| MicroPython machine.Pin or Pin constructors | 48 |
| Python sleep/sleep_ms/sleep_us | 44 |
| ADC / PWM constructors | 16 / 6 |
| I2C or SoftI2C constructors | 9 |
| network.WLAN / socket member calls | 28 / 14 |
| RTOS task/delay calls | 2 |
| attachInterrupt | 0 |

Retain bus addresses, explicit SPI/I2C pin initialization, baud rates, pullup/active-LOW semantics, ADC resolution, PWM frequency/duty scaling, sensor protocol selection, timeouts, task ownership and required support modules in grounded requirements. Regex counts cannot establish their correctness.

## Action plan: build a grounded corpus, not retrain a model

1. **Preserve each original record by ID and hashes.** Index descriptions, typed execution domain, complete file manifest, board instances, parts, endpoints, dependencies, adaptations and non-wire relationships. Keep canonical and raw wiring side by side with explicit resolution provenance.
2. **Gate inference on structure.** Require board-specific logical GPIO-to-header aliases, stable instance IDs, complete component pins and property schemas. Route the 76 boardless examples separately. Prioritize the high-reuse missing models/pins before expanding advertised availability.
3. **Store negative evidence and mismatches.** Retrieve named source/wire evidence alongside matches, especially the Pico GPIO discrepancies, missing gas/soil channels, logic probe and robot. Never select an example solely because its title matches a requested feature.
4. **Represent dependency/runtime requirements precisely.** Separate Arduino core/builtin/external headers, MicroPython modules/local files, host services, ROM/custom WASM, and network credentials. Pin resolved versions when verified; distinguish static canonical pass from compile support and measured execution.
5. **Fix truncation without silently losing source.** Bounded previews should reference full manifests/files; `robot-desktop-eyes` must not become a plausible single-file sketch. Add comma-separated import extraction and distinguish active entrypoints from optional files.
6. **Use staged acceptance gates.** Start with deterministic raw-to-canonical endpoint/identity checks, limited topology diagnostics and source-pin consistency; then selectively compile corrected eligible projects; finally verify runtime observations and timing against explicit tests. Do not compile all 321 as a substitute for structural validation.
7. **Keep user-facing claims calibrated.** Existing `get_example_reference()` and `search_example_requirements()` already expose source origins, blockers, normalization failures and verification fields. Consume those as grounded retrieval evidence. `samples/all` availability is limited to the six selected starters; corpus coverage does not mean all 321 can be opened/run. Example text such as “Verifies ESP32 emulation is working” or “Runs in the browser” remains unverified upstream prose.

## Coverage appendix

The following appendix is generated by iterating every raw record, joining its saved analysis, and recording source origin/size, circuit sizes and blocker categories. A row is evidence of inspection coverage, not certification. Saved canonical status is not rerun status.

| # | Example ID | Language | Source origin / characters | Parts / wires | Saved canonical | Saved classification | Saved blockers |
|---:|---|---|---|---:|---|---|---|
| 1 | `uno-oled-4pin-i2c` | arduino | boards.code[1] / 830 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 2 | `esp32-oled-4pin-i2c` | arduino | boards.code[1] / 817 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 3 | `esp32-micropython-external-library` | micropython | files[2] / 5614 | 1 / 4 | failed | blocked | canonical_validation_gap, multi_file, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 4 | `esp32-idf-blink` | espidf | files[1] / 664 | 2 / 3 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unsupported_language, unsupported_source_file |
| 5 | `pico-oled-4pin-i2c` | arduino | boards.code[1] / 875 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 6 | `stm32-oled-4pin-i2c` | arduino | boards.code[1] / 844 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout, unsupported_board |
| 7 | `ky-040-rotary-encoder` | arduino | code / 1156 | 1 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 8 | `stm32-bluepill-blink` | arduino | boards.code[1] / 327 | 0 / 0 | failed | blocked | canonical_validation_gap, unsupported_board |
| 9 | `stm32-bluepill-serial-counter` | arduino | boards.code[1] / 388 | 0 / 0 | failed | blocked | canonical_validation_gap, unsupported_board |
| 10 | `stm32-f4-discovery-blink` | arduino | boards.code[1] / 368 | 0 / 0 | failed | blocked | canonical_validation_gap, unsupported_board |
| 11 | `stm32-olimex-h405-blink` | arduino | boards.code[1] / 285 | 0 / 0 | failed | blocked | canonical_validation_gap, unsupported_board |
| 12 | `stm32-netduino-plus2-blink` | arduino | boards.code[1] / 278 | 0 / 0 | failed | blocked | canonical_validation_gap, unsupported_board |
| 13 | `stm32-netduino2-serial` | arduino | boards.code[1] / 445 | 0 / 0 | failed | blocked | canonical_validation_gap, unsupported_board |
| 14 | `stm32-blackpill-f401-blink` | arduino | boards.code[1] / 309 | 0 / 0 | failed | blocked | canonical_validation_gap, unsupported_board |
| 15 | `stm32-bluepill-f103cb-blink` | arduino | boards.code[1] / 323 | 0 / 0 | failed | blocked | canonical_validation_gap, unsupported_board |
| 16 | `stm32-uno-gpio-mirror` | arduino | boards.code[2] / 888 | 0 / 2 | failed | blocked | canonical_validation_gap, multi_board, unsupported_board |
| 17 | `stm32-uno-serial-link` | arduino | boards.code[2] / 784 | 0 / 2 | failed | blocked | canonical_validation_gap, multi_board, unsupported_board |
| 18 | `stm32-esp32-gpio-sync` | arduino | boards.code[2] / 706 | 0 / 2 | failed | blocked | canonical_validation_gap, multi_board, runtime_unavailable, unsupported_board |
| 19 | `stm32-blackpill-blink` | arduino | boards.code[1] / 348 | 0 / 0 | failed | blocked | canonical_validation_gap, unsupported_board |
| 20 | `stm32-bluepill-blackpill-gpio` | arduino | boards.code[2] / 802 | 0 / 2 | failed | blocked | canonical_validation_gap, multi_board, unsupported_board |
| 21 | `stm32-bluepill-bmp280` | arduino | boards.code[1] / 998 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout, unsupported_board |
| 22 | `stm32-bluepill-oled` | arduino | boards.code[1] / 1237 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout, unsupported_board |
| 23 | `stm32-bluepill-mpu6050` | arduino | boards.code[1] / 1158 | 1 / 4 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_board |
| 24 | `stm32-bluepill-rtc` | arduino | boards.code[1] / 1037 | 1 / 4 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_board |
| 25 | `stm32-blackpill-oled` | arduino | boards.code[1] / 931 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout, unsupported_board |
| 26 | `stm32-bluepill-weather-station` | arduino | boards.code[1] / 1256 | 2 / 8 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout, unsupported_board |
| 27 | `stm32-bluepill-7segment` | arduino | boards.code[1] / 648 | 1 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_board |
| 28 | `stm32-bluepill-rgb` | arduino | boards.code[1] / 678 | 4 / 7 | failed | blocked | canonical_validation_gap, unsupported_board |
| 29 | `stm32-bluepill-button` | arduino | boards.code[1] / 645 | 1 / 2 | failed | blocked | canonical_validation_gap, unsupported_board |
| 30 | `stm32-bluepill-switch` | arduino | boards.code[1] / 586 | 1 / 3 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_board |
| 31 | `stm32-bluepill-stepper` | arduino | boards.code[1] / 764 | 1 / 4 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_board |
| 32 | `uno-stepper-a4988` | arduino | boards.code[1] / 485 | 2 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 33 | `esp32-stepper-a4988` | arduino | boards.code[1] / 420 | 2 / 6 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout |
| 34 | `pico-stepper-a4988` | arduino | boards.code[1] / 424 | 2 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 35 | `blink-led` | arduino | code / 197 | 1 / 0 | passed | canonical_candidate_unverified | none |
| 36 | `traffic-light` | arduino | code / 668 | 7 / 9 | passed | canonical_candidate_unverified | none |
| 37 | `button-led` | arduino | code / 357 | 4 / 5 | passed | selected_starter | none |
| 38 | `fade-led` | arduino | code / 351 | 3 / 3 | passed | canonical_candidate_unverified | none |
| 39 | `serial-hello` | arduino | code / 306 | 1 / 0 | passed | selected_starter | none |
| 40 | `rgb-led` | arduino | code / 749 | 5 / 7 | passed | canonical_candidate_unverified | none |
| 41 | `simon-says` | arduino | code / 1662 | 13 / 20 | passed | canonical_candidate_unverified | none |
| 42 | `pico-doom-raycaster` | arduino | code / 6412 | 5 / 17 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 43 | `tft-display` | arduino | code / 1770 | 2 / 6 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 44 | `lcd-hello` | arduino | code / 776 | 2 / 6 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 45 | `serial-echo` | arduino | code / 1181 | 1 / 0 | passed | canonical_candidate_unverified | none |
| 46 | `serial-led-control` | arduino | code / 1378 | 3 / 3 | passed | canonical_candidate_unverified | none |
| 47 | `i2c-scanner` | arduino | code / 1664 | 4 / 16 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 48 | `i2c-rtc-read` | arduino | code / 1675 | 2 / 4 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 49 | `i2c-eeprom-rw` | arduino | code / 1855 | 2 / 8 | failed | blocked | canonical_validation_gap, unsupported_component |
| 50 | `spi-loopback` | arduino | code / 1399 | 1 / 0 | passed | canonical_candidate_unverified | none |
| 51 | `multi-protocol` | arduino | code / 3266 | 3 / 12 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 52 | `pico-blink` | arduino | code / 368 | 2 / 3 | passed | selected_starter | none |
| 53 | `pico-serial-echo` | arduino | code / 693 | 2 / 3 | passed | canonical_candidate_unverified | none |
| 54 | `pico-serial-led-control` | arduino | code / 876 | 2 / 3 | passed | canonical_candidate_unverified | none |
| 55 | `pico-i2c-scanner` | arduino | code / 1248 | 6 / 18 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 56 | `pico-i2c-rtc-read` | arduino | code / 1845 | 5 / 10 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 57 | `pico-i2c-eeprom-rw` | arduino | code / 1688 | 5 / 14 | failed | blocked | canonical_validation_gap, unsupported_component |
| 58 | `pico-spi-loopback` | arduino | code / 1120 | 6 / 9 | passed | canonical_candidate_unverified | none |
| 59 | `pico-adc-read` | arduino | code / 954 | 4 / 9 | passed | canonical_candidate_unverified | none |
| 60 | `pico-multi-protocol` | arduino | code / 2846 | 9 / 24 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 61 | `esp32-blink-led` | arduino | code / 671 | 2 / 3 | passed | blocked | runtime_unavailable |
| 62 | `uno-neopixel-colours` | arduino | code / 802 | 1 / 3 | passed | blocked | dependency_unverified |
| 63 | `esp32-neopixel-colours` | arduino | code / 623 | 1 / 3 | passed | blocked | dependency_unverified, runtime_unavailable |
| 64 | `esp32-serial-echo` | arduino | code / 529 | 0 / 0 | passed | blocked | runtime_unavailable |
| 65 | `pi-to-arduino-led-control` | arduino | boards.code[1] / 1437 | 4 / 9 | failed | blocked | canonical_validation_gap, multi_board, runtime_unavailable |
| 66 | `dual-pico-serial1-passthrough` | arduino | boards.code[2] / 2013 | 0 / 3 | failed | blocked | canonical_validation_gap, multi_board, runtime_unavailable |
| 67 | `dual-pico-bidirectional-handshake` | arduino | boards.code[2] / 2306 | 0 / 3 | failed | blocked | canonical_validation_gap, multi_board, runtime_unavailable |
| 68 | `dual-pico-digital-mirror` | arduino | boards.code[2] / 1143 | 0 / 2 | failed | blocked | canonical_validation_gap, multi_board, runtime_unavailable |
| 69 | `nano-blink` | arduino | code / 303 | 0 / 0 | passed | canonical_candidate_unverified | none |
| 70 | `nano-serial` | arduino | code / 471 | 0 / 0 | passed | canonical_candidate_unverified | none |
| 71 | `nano-button-led` | arduino | code / 335 | 3 / 5 | passed | selected_starter | none |
| 72 | `nano-fade` | arduino | code / 390 | 2 / 3 | passed | canonical_candidate_unverified | none |
| 73 | `mega-blink` | arduino | code / 287 | 0 / 0 | passed | selected_starter | none |
| 74 | `mega-serial` | arduino | code / 538 | 0 / 0 | passed | canonical_candidate_unverified | none |
| 75 | `mega-led-chase` | arduino | code / 546 | 16 / 24 | passed | canonical_candidate_unverified | none |
| 76 | `mega-serial-control` | arduino | code / 1124 | 16 / 24 | passed | canonical_candidate_unverified | none |
| 77 | `c3-blink` | arduino | code / 389 | 2 / 3 | passed | blocked | runtime_unavailable |
| 78 | `c3-serial` | arduino | code / 444 | 0 / 0 | passed | blocked | runtime_unavailable |
| 79 | `c3-rgb` | arduino | code / 882 | 4 / 7 | passed | blocked | runtime_unavailable |
| 80 | `c3-button` | arduino | code / 488 | 3 / 5 | passed | blocked | runtime_unavailable |
| 81 | `c3-serial-echo` | arduino | code / 437 | 0 / 0 | passed | blocked | runtime_unavailable |
| 82 | `uno-7segment` | arduino | code / 868 | 1 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 83 | `pico-7segment` | arduino | code / 806 | 1 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 84 | `esp32-7segment` | arduino | code / 807 | 1 / 8 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout |
| 85 | `uno-potentiometer` | arduino | code / 520 | 1 / 3 | passed | canonical_candidate_unverified | none |
| 86 | `uno-rgb-cycle` | arduino | code / 843 | 4 / 7 | passed | canonical_candidate_unverified | none |
| 87 | `pico-button-led` | arduino | code / 402 | 3 / 5 | passed | selected_starter | none |
| 88 | `pico-rgb` | arduino | code / 810 | 4 / 7 | passed | canonical_candidate_unverified | none |
| 89 | `uno-dht22` | arduino | code / 1011 | 1 / 3 | failed | blocked | canonical_validation_gap, dependency_unverified |
| 90 | `uno-hcsr04` | arduino | code / 876 | 1 / 4 | failed | blocked | canonical_validation_gap |
| 91 | `uno-pir` | arduino | code / 701 | 1 / 3 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 92 | `uno-servo` | arduino | code / 648 | 1 / 3 | passed | blocked | dependency_unverified |
| 93 | `uno-photoresistor` | arduino | code / 745 | 3 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 94 | `uno-ntc` | arduino | code / 1214 | 1 / 3 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 95 | `pico-dht22` | arduino | code / 713 | 1 / 3 | failed | blocked | canonical_validation_gap, dependency_unverified |
| 96 | `pico-hcsr04` | arduino | code / 804 | 1 / 4 | failed | blocked | canonical_validation_gap |
| 97 | `pico-pir` | arduino | code / 733 | 1 / 3 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 98 | `pico-servo` | arduino | code / 540 | 1 / 3 | failed | blocked | canonical_validation_gap, dependency_unverified |
| 99 | `pico-ntc` | arduino | code / 864 | 1 / 3 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 100 | `pico-joystick` | arduino | code / 803 | 1 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 101 | `esp32-dht22` | arduino | code / 615 | 1 / 3 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable |
| 102 | `esp32-hcsr04` | arduino | code / 711 | 1 / 4 | failed | blocked | canonical_validation_gap, runtime_unavailable |
| 103 | `esp32-mpu6050` | arduino | code / 998 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 104 | `esp32-pir` | arduino | code / 801 | 1 / 3 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout |
| 105 | `esp32-servo` | arduino | code / 629 | 2 / 6 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable |
| 106 | `esp32-joystick` | arduino | code / 707 | 1 / 5 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout |
| 107 | `c3-dht22` | arduino | code / 621 | 1 / 3 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable |
| 108 | `c3-hcsr04` | arduino | code / 717 | 1 / 4 | failed | blocked | canonical_validation_gap, runtime_unavailable |
| 109 | `c3-pir` | arduino | code / 749 | 1 / 3 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout |
| 110 | `c3-servo` | arduino | code / 533 | 1 / 3 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable |
| 111 | `esp32c3-wifi-scan` | arduino | code / 759 | 0 / 0 | passed | blocked | dependency_unverified, network_or_radio_requirement, runtime_unavailable |
| 112 | `esp32c3-wifi-connect` | arduino | code / 886 | 0 / 0 | passed | blocked | dependency_unverified, network_or_radio_requirement, runtime_unavailable |
| 113 | `esp32c3-http-server` | arduino | code / 1863 | 0 / 0 | passed | blocked | dependency_unverified, network_or_radio_requirement, runtime_unavailable |
| 114 | `esp32c3-ble-advertise` | arduino | code / 2093 | 0 / 0 | passed | blocked | dependency_unverified, network_or_radio_requirement, runtime_unavailable |
| 115 | `esp32-wifi-scan` | arduino | code / 753 | 0 / 0 | passed | blocked | dependency_unverified, network_or_radio_requirement, runtime_unavailable |
| 116 | `esp32-wifi-connect` | arduino | code / 880 | 0 / 0 | passed | blocked | dependency_unverified, network_or_radio_requirement, runtime_unavailable |
| 117 | `esp32-http-server` | arduino | code / 1839 | 0 / 0 | passed | blocked | dependency_unverified, network_or_radio_requirement, runtime_unavailable |
| 118 | `esp32-ble-advertise` | arduino | code / 2076 | 0 / 0 | passed | blocked | dependency_unverified, network_or_radio_requirement, runtime_unavailable |
| 119 | `esp32-bmp280` | arduino | code / 1008 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 120 | `esp32-oled` | arduino | code / 1167 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 121 | `attiny85-blink` | arduino | boards.code[1] / 242 | 2 / 3 | failed | blocked | canonical_validation_gap, unsupported_board |
| 122 | `attiny85-button-led` | arduino | boards.code[1] / 371 | 3 / 5 | failed | blocked | canonical_validation_gap, unsupported_board |
| 123 | `attiny85-pwm-fade` | arduino | boards.code[1] / 445 | 2 / 3 | failed | blocked | canonical_validation_gap, unsupported_board |
| 124 | `attiny85-ntc-sensor` | arduino | boards.code[1] / 1181 | 3 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_board |
| 125 | `esp32cam-webcam-demo` | arduino | code / 2546 | 0 / 0 | failed | blocked | canonical_validation_gap, dependency_unverified, unsupported_board |
| 126 | `esp32cam-lcd-preview` | arduino | code / 5092 | 1 / 8 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout, unsupported_board |
| 127 | `esp32-doom` | arduino | code / 7926 | 5 / 17 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 128 | `pi3-blink-led` | arduino | code / 0 | 2 / 3 | failed | blocked | canonical_validation_gap, runtime_unavailable |
| 129 | `pi3-running-lights` | arduino | code / 0 | 10 / 15 | failed | blocked | canonical_validation_gap, runtime_unavailable |
| 130 | `pi4-button-led` | arduino | code / 0 | 3 / 5 | failed | blocked | canonical_validation_gap, runtime_unavailable |
| 131 | `pi4-rgb-color-cycle` | arduino | code / 0 | 4 / 7 | failed | blocked | canonical_validation_gap, runtime_unavailable |
| 132 | `pi5-pir-motion-alarm` | arduino | code / 0 | 3 / 6 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout |
| 133 | `pi5-traffic-light` | arduino | code / 0 | 6 / 9 | failed | blocked | canonical_validation_gap, runtime_unavailable |
| 134 | `voltage-divider` | arduino | code / 246 | 3 / 4 | passed | canonical_candidate_unverified | none |
| 135 | `rc-low-pass-filter` | arduino | code / 327 | 3 / 4 | passed | canonical_candidate_unverified | none |
| 136 | `wheatstone-bridge` | arduino | code / 303 | 5 / 8 | passed | canonical_candidate_unverified | none |
| 137 | `ntc-temperature` | arduino | code / 479 | 2 / 3 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 138 | `led-current-limiting` | arduino | code / 203 | 3 / 3 | passed | canonical_candidate_unverified | none |
| 139 | `parallel-resistors` | arduino | code / 352 | 5 / 8 | passed | canonical_candidate_unverified | none |
| 140 | `pot-adc-reader` | arduino | code / 227 | 2 / 3 | passed | canonical_candidate_unverified | none |
| 141 | `photoresistor-light` | arduino | code / 235 | 2 / 3 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 142 | `multi-led-bar` | arduino | code / 235 | 11 / 15 | passed | canonical_candidate_unverified | none |
| 143 | `capacitor-charge-curve` | arduino | code / 307 | 3 / 4 | passed | canonical_candidate_unverified | none |
| 144 | `npn-led-switch` | arduino | code / 195 | 5 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 145 | `pnp-high-side-switch` | arduino | code / 211 | 5 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 146 | `mosfet-pwm-led` | arduino | code / 203 | 5 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 147 | `diode-rectifier` | arduino | code / 168 | 4 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 148 | `zener-regulator` | arduino | code / 247 | 4 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 149 | `schottky-reverse-protection` | arduino | code / 202 | 4 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 150 | `bjt-common-emitter` | arduino | code / 186 | 8 / 12 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 151 | `darlington-high-current` | arduino | code / 338 | 6 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 152 | `opamp-inverting` | arduino | code / 298 | 7 / 12 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 153 | `opamp-voltage-follower` | arduino | code / 298 | 3 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 154 | `opamp-comparator` | arduino | code / 276 | 7 / 11 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 155 | `opamp-difference` | arduino | code / 390 | 8 / 15 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 156 | `opamp-schmitt-trigger` | arduino | code / 222 | 7 / 12 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 157 | `mixed-and-transistor-driver` | arduino | code / 301 | 6 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 158 | `and-gate-alarm` | arduino | code / 106 | 8 / 11 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 159 | `xor-toggle-detector` | arduino | code / 274 | 6 / 9 | failed | blocked | canonical_validation_gap, unsupported_component |
| 160 | `nand-sr-latch` | arduino | code / 615 | 9 / 16 | failed | blocked | canonical_validation_gap, unsupported_component |
| 161 | `full-adder` | arduino | code / 604 | 8 / 12 | passed | canonical_candidate_unverified | none |
| 162 | `binary-counter-leds` | arduino | code / 216 | 9 / 12 | passed | canonical_candidate_unverified | none |
| 163 | `logic-probe` | arduino | code / 353 | 5 / 6 | passed | canonical_candidate_unverified | none |
| 164 | `relay-led-switch` | arduino | code / 189 | 6 / 9 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 165 | `optocoupler-signal` | arduino | code / 380 | 4 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 166 | `l293d-motor-control` | arduino | code / 553 | 3 / 9 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 167 | `l293d-speed-pwm` | arduino | code / 384 | 4 / 12 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 168 | `power-supply-7805` | arduino | code / 317 | 4 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 169 | `lm317-adjustable-psu` | arduino | code / 273 | 6 / 9 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 170 | `battery-voltage-monitor` | arduino | code / 373 | 4 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 171 | `esp32-dual-adc` | arduino | code / 314 | 3 / 6 | passed | blocked | runtime_unavailable |
| 172 | `mega-multi-led` | arduino | code / 281 | 17 / 24 | passed | canonical_candidate_unverified | none |
| 173 | `nano-sensor-station` | arduino | code / 426 | 3 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 174 | `esp32-pwm-led-rgb` | arduino | code / 720 | 5 / 7 | passed | blocked | runtime_unavailable |
| 175 | `an-voltage-divider` | arduino | code / 156 | 4 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 176 | `an-series-resistors` | arduino | code / 156 | 5 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 177 | `an-parallel-resistors` | arduino | code / 156 | 5 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 178 | `an-rc-low-pass` | arduino | code / 156 | 4 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 179 | `an-rc-high-pass` | arduino | code / 156 | 4 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 180 | `an-rl-low-pass` | arduino | code / 156 | 4 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 181 | `an-rlc-series-resonance` | arduino | code / 156 | 5 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 182 | `an-half-wave-rectifier` | arduino | code / 156 | 4 / 5 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 183 | `an-bridge-rectifier` | arduino | code / 156 | 7 / 10 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 184 | `an-smoothed-rectifier` | arduino | code / 156 | 5 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 185 | `an-zener-regulator` | arduino | code / 156 | 5 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 186 | `an-diode-clipper` | arduino | code / 156 | 5 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 187 | `an-diode-clamper` | arduino | code / 156 | 5 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 188 | `an-voltage-doubler` | arduino | code / 156 | 7 / 10 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 189 | `an-bjt-common-emitter` | arduino | code / 156 | 9 / 13 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 190 | `an-bjt-emitter-follower` | arduino | code / 156 | 6 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 191 | `an-bjt-switch` | arduino | code / 156 | 6 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 192 | `an-darlington` | arduino | code / 156 | 7 / 10 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 193 | `an-current-mirror` | arduino | code / 156 | 6 / 9 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 194 | `an-bjt-diff-pair` | arduino | code / 156 | 9 / 13 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 195 | `an-mosfet-switch` | arduino | code / 156 | 7 / 10 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 196 | `an-mosfet-common-source` | arduino | code / 156 | 9 / 13 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 197 | `an-mosfet-pmos-highside` | arduino | code / 156 | 6 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 198 | `an-opamp-inverting` | arduino | code / 156 | 6 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 199 | `an-opamp-non-inverting` | arduino | code / 156 | 5 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 200 | `an-opamp-follower` | arduino | code / 156 | 4 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 201 | `an-opamp-summing` | arduino | code / 156 | 8 / 11 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 202 | `an-opamp-integrator` | arduino | code / 156 | 6 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 203 | `an-opamp-comparator` | arduino | code / 156 | 5 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 204 | `an-schmitt-trigger` | arduino | code / 156 | 6 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 205 | `digital-not-inverter` | arduino | code / 211 | 6 / 7 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 206 | `digital-and-two-switches` | arduino | code / 211 | 8 / 11 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 207 | `digital-or-any-switch` | arduino | code / 211 | 8 / 11 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 208 | `digital-nand-two-switches` | arduino | code / 211 | 8 / 11 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 209 | `digital-nor-idle-light` | arduino | code / 211 | 8 / 11 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 210 | `digital-xor-difference` | arduino | code / 211 | 8 / 11 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 211 | `digital-xnor-equality` | arduino | code / 211 | 8 / 11 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 212 | `digital-and3-all-on` | arduino | code / 211 | 10 / 15 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 213 | `digital-half-adder` | arduino | code / 211 | 11 / 16 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 214 | `digital-full-adder` | arduino | code / 211 | 16 / 25 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 215 | `digital-mux-2to1` | arduino | code / 211 | 13 / 19 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 216 | `digital-comparator-equal-2bit` | arduino | code / 211 | 14 / 21 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 217 | `digital-majority-voter` | arduino | code / 211 | 13 / 21 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 218 | `digital-xor-from-nands` | arduino | code / 211 | 11 / 17 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 219 | `digital-aoi-gate` | arduino | code / 211 | 14 / 21 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 220 | `digital-buffer-three-inverters` | arduino | code / 211 | 8 / 9 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 221 | `digital-and4-all-on` | arduino | code / 211 | 12 / 19 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 222 | `digital-comparator-magnitude-1bit` | arduino | code / 211 | 16 / 23 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 223 | `digital-decoder-2to4` | arduino | code / 211 | 19 / 28 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 224 | `digital-parity-4bit` | arduino | code / 211 | 14 / 21 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 225 | `digital-mux-4to1` | arduino | code / 211 | 26 / 43 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 226 | `digital-half-subtractor` | arduino | code / 211 | 12 / 17 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 227 | `digital-ripple-adder-4bit` | arduino | code / 211 | 49 / 82 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 228 | `digital-multiplier-2x2` | arduino | code / 211 | 25 / 40 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 229 | `digital-comparator-4bit` | arduino | code / 211 | 41 / 72 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 230 | `digital-priority-encoder-8to3` | arduino | code / 211 | 35 / 63 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 231 | `digital-decoder-3to8` | arduino | code / 211 | 34 / 60 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 232 | `digital-binary-to-gray-3bit` | arduino | code / 211 | 15 / 22 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 233 | `digital-bcd-validity` | arduino | code / 211 | 15 / 22 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 234 | `digital-half-adder-nand-only` | arduino | code / 211 | 15 / 24 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 235 | `digital-gray-to-binary-3bit` | arduino | code / 211 | 15 / 22 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 236 | `digital-compressor-4to2` | arduino | code / 211 | 27 / 44 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 237 | `digital-popcount-4bit` | arduino | code / 211 | 26 / 43 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 238 | `digital-hamming-encoder-74` | arduino | code / 211 | 29 / 45 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 239 | `digital-adder-subtractor-4bit` | arduino | code / 211 | 53 / 90 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 240 | `digital-alu-slice-1bit` | arduino | code / 211 | 30 / 55 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 241 | `digital-carry-lookahead-adder-4bit` | arduino | code / 211 | 57 / 112 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 242 | `digital-bcd-7seg-segment-a` | arduino | code / 211 | 16 / 25 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 243 | `digital-ripple-counter-4bit` | arduino | code / 211 | 15 / 23 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 244 | `100d-aqi-esp` | micropython | files[3] / 8234 | 7 / 19 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 245 | `100d-auto-night-light-using-ldr-esp32-plus-micropython` | micropython | files[1] / 520 | 3 / 6 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 246 | `100d-battery-monitor-with-blynk-iot` | micropython | files[2] / 10867 | 1 / 3 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unsupported_language |
| 247 | `100d-bluetooth-based-wireless-led-control-system` | micropython | files[1] / 1388 | 2 / 3 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 248 | `100d-blynk-based-iot-relay-control-micropython` | micropython | files[2] / 10025 | 3 / 6 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 249 | `100d-blynk-controlled-dc-brushless-fan` | micropython | files[2] / 9918 | 3 / 6 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 250 | `100d-clap-toggle-switch-using-esp32-and-digital-sound-sensor-micropython` | micropython | files[1] / 616 | 4 / 7 | failed | blocked | canonical_validation_gap, runtime_unavailable, unsupported_language, unsupported_source_file |
| 251 | `100d-dc-motor-speed-control-web-slider` | micropython | files[1] / 1605 | 6 / 9 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 252 | `100d-dht11-web-server-using-esp32-and-micropython` | micropython | files[1] / 3751 | 1 / 3 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 253 | `100d-dimmer-led-using-potentiometer-micropython` | micropython | files[1] / 410 | 3 / 6 | failed | blocked | canonical_validation_gap, runtime_unavailable, unsupported_language, unsupported_source_file |
| 254 | `100d-dual-ir-entry-exit-detector-with-telegram-alerts` | micropython | files[1] / 2138 | 8 / 14 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 255 | `100d-eeprom-simulation-using-micropython-on-esp32-wokwi` | micropython | files[1] / 1529 | 0 / 0 | failed | blocked | canonical_validation_gap, runtime_unavailable, unsupported_language, unsupported_source_file |
| 256 | `100d-esp32-ble-led-control` | micropython | files[1] / 2783 | 2 / 3 | failed | blocked | canonical_validation_gap, runtime_unavailable, unsupported_language, unsupported_source_file |
| 257 | `100d-esp32-hotspot-access-point-setup-micropython` | micropython | files[1] / 318 | 0 / 0 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 258 | `100d-esp32-ir-sensor-telegram-alert-micropython` | micropython | files[1] / 1139 | 2 / 4 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 259 | `100d-esp32-oled-smart-ui-eyes-animation-time-and-weather-micropython` | micropython | files[2] / 9525 | 3 / 8 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 260 | `100d-flask-server-based-led-control-using-micropython` | micropython | files[2] / 1148 | 2 / 3 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unsupported_language |
| 261 | `100d-iot-atmospheric-monitoring-system-using-esp32-wowki-and-blynk` | micropython | files[3] / 13710 | 1 / 4 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 262 | `100d-iot-based-dsm-smart-metering` | micropython | files[4] / 21262 | 9 / 18 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unsupported_language |
| 263 | `100d-iot-environment-monitoring-with-anomaly-detection` | micropython | files[1] / 1488 | 1 / 3 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 264 | `100d-iot-relay-control-web-server-raspberry-pi-pico-2w` | micropython | files[1] / 2615 | 3 / 6 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 265 | `100d-iot-smart-irrigation-system` | micropython | files[2] / 10893 | 4 / 9 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 266 | `100d-joystick-controlled-servo` | micropython | files[1] / 1258 | 2 / 6 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 267 | `100d-joystick-direction-display-with-oled` | micropython | files[2] / 6130 | 2 / 9 | failed | blocked | canonical_validation_gap, multi_file, unresolved_pin_layout, unsupported_language |
| 268 | `100d-mq4-gas-leak-detection-system-using-esp32-and-micropython` | micropython | files[1] / 707 | 2 / 5 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 269 | `100d-mq7-co-gas-detection-esp32` | micropython | files[1] / 542 | 1 / 3 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 270 | `100d-mq-135-gas-sensor-with-esp32-micropython` | micropython | files[1] / 537 | 1 / 3 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 271 | `100d-micropython-watch` | micropython | files[2] / 7252 | 1 / 4 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 272 | `100d-ntp-synchronized-digital-clock-using-esp32-and-max7219` | micropython | files[2] / 4843 | 0 / 0 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unsupported_language |
| 273 | `100d-ota-update-pico2w` | micropython | files[3] / 2327 | 2 / 3 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unsupported_language |
| 274 | `100d-pir-motion-detector-using-raspberry-pi-pico-2w-and-micropython` | micropython | files[1] / 439 | 3 / 6 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 275 | `100d-password-lock-system-using-esp32` | micropython | files[3] / 12711 | 6 / 18 | failed | blocked | canonical_validation_gap, multi_file, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 276 | `100d-pico-2-w-dht11-http-csv-logger` | micropython | files[2] / 1540 | 1 / 3 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unsupported_language |
| 277 | `100d-pico-w-async-led-control-micropython` | micropython | files[1] / 2099 | 2 / 3 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 278 | `100d-pico-w-web-servo-controller` | micropython | files[1] / 7578 | 1 / 3 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 279 | `100d-potentiometer-visualizer` | micropython | files[1] / 491 | 2 / 23 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 280 | `100d-pulse-monitor` | micropython | files[2] / 7750 | 2 / 7 | failed | blocked | canonical_validation_gap, multi_file, runtime_unavailable, unresolved_pin_layout, unsupported_language |
| 281 | `100d-rgb-color-mixer-using-potentiometers-esp32-plus-micropython` | micropython | files[1] / 1150 | 7 / 16 | failed | blocked | canonical_validation_gap, runtime_unavailable, unsupported_language, unsupported_source_file |
| 282 | `100d-raspberry-pi-pico-2-w-thingsboard-iot` | micropython | files[2] / 9562 | 1 / 3 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unsupported_language |
| 283 | `100d-servo-motor-control-with-raspberry-pi-pico-2-w-micropython` | micropython | files[1] / 659 | 1 / 3 | failed | blocked | canonical_validation_gap, runtime_unavailable, unsupported_language, unsupported_source_file |
| 284 | `100d-single-digit-seven-segment-display-with-raspberry-pi-pico-micropython` | micropython | files[1] / 2767 | 1 / 8 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 285 | `100d-smart-home-automation-system` | micropython | files[2] / 12467 | 9 / 15 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unsupported_language |
| 286 | `100d-smart-indoor-security-system` | micropython | files[1] / 3795 | 2 / 11 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 287 | `100d-smart-iot-gas-monitoring-system` | micropython | files[3] / 5917 | 1 / 3 | failed | blocked | canonical_validation_gap, multi_file, network_or_radio_requirement, runtime_unavailable, unsupported_language |
| 288 | `100d-stepper-motor-control-using-esp32-and-a4988-micropython` | micropython | files[1] / 719 | 2 / 11 | failed | blocked | canonical_validation_gap, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 289 | `100d-temperature-based-led-indicator-micropython-esp32` | micropython | files[1] / 1022 | 7 / 12 | failed | blocked | canonical_validation_gap, runtime_unavailable, unsupported_language, unsupported_source_file |
| 290 | `100d-ultrasonic-led-distance-indicator-esp32-micropython` | micropython | files[2] / 3348 | 5 / 10 | failed | blocked | canonical_validation_gap, multi_file, runtime_unavailable, unsupported_language |
| 291 | `100d-websocket-led-control-using-raspberry-pi-pico-w` | micropython | files[1] / 2729 | 2 / 3 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unsupported_language, unsupported_source_file |
| 292 | `100d-wi-fi-controlled-4wd-robot-car` | micropython | files[1] / 3029 | 1 / 16 | failed | blocked | canonical_validation_gap, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout, unsupported_language, unsupported_source_file |
| 293 | `epaper-1in54-uno-hello` | arduino | code / 842 | 1 / 8 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 294 | `epaper-2in13-pico-clock` | arduino | code / 1001 | 1 / 8 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 295 | `epaper-2in9-esp32-weather` | arduino | code / 847 | 1 / 8 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 296 | `epaper-4in2-pico-image` | arduino | code / 1163 | 1 / 8 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 297 | `epaper-7in5-esp32-dashboard` | arduino | code / 1246 | 1 / 8 | failed | blocked | canonical_validation_gap, dependency_unverified, network_or_radio_requirement, runtime_unavailable, unresolved_pin_layout |
| 298 | `epaper-2in9-bwr-esp32-alert` | arduino | code / 1343 | 1 / 8 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 299 | `epaper-5in65-7c-esp32-rainbow` | arduino | code / 1170 | 1 / 8 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 300 | `i8080-banner-streamer` | arduino | code / 828 | 1 / 4 | failed | blocked | canonical_validation_gap, unsupported_component |
| 301 | `i8080-button-counter` | arduino | code / 374 | 22 / 34 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component |
| 302 | `i8080-killbits` | arduino | files[1] / 1116 | 34 / 58 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component, unsupported_source_file |
| 303 | `z80-larson-scanner` | arduino | files[1] / 978 | 18 / 26 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component, unsupported_source_file |
| 304 | `z80-led-chaser-c` | arduino | files[1] / 1357 | 18 / 26 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component, unsupported_source_file |
| 305 | `z80-larson-no-board` | arduino | files[1] / 820 | 18 / 26 | failed | blocked | canonical_validation_gap, unresolved_pin_layout, unsupported_component, unsupported_source_file |
| 306 | `galaksija-z80-computer` | arduino | code / 0 | 6 / 76 | failed | blocked | canonical_validation_gap, unsupported_component |
| 307 | `robot-desktop-eyes` | arduino | files[34] / 98540 | 8 / 22 | failed | blocked | canonical_validation_gap, dependency_unverified, multi_file, runtime_unavailable, unresolved_pin_layout |
| 308 | `microsd-card-uno` | arduino | code / 1420 | 1 / 6 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 309 | `microsd-card-esp32` | arduino | code / 1287 | 1 / 6 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 310 | `ir-remote-uno` | arduino | code / 1764 | 2 / 3 | failed | blocked | canonical_validation_gap, dependency_unverified, unresolved_pin_layout |
| 311 | `ir-two-receivers-uno` | arduino | code / 2252 | 3 / 6 | failed | blocked | canonical_validation_gap, unresolved_pin_layout |
| 312 | `ir-remote-esp32` | arduino | code / 1072 | 2 / 3 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 313 | `esp32-wifi-mqtt` | arduino | code / 2299 | 0 / 0 | passed | blocked | dependency_unverified, network_or_radio_requirement, runtime_unavailable |
| 314 | `esp32s3-ili9341-hello` | arduino | boards.code[1] / 834 | 1 / 9 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 315 | `esp32s3-blink-led` | arduino | code / 503 | 2 / 3 | passed | blocked | runtime_unavailable |
| 316 | `esp32s3-serial-echo` | arduino | code / 533 | 0 / 0 | passed | blocked | runtime_unavailable |
| 317 | `esp32s3-oled-i2c` | arduino | code / 1226 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 318 | `esp32s3-potentiometer` | arduino | code / 415 | 1 / 3 | passed | blocked | runtime_unavailable |
| 319 | `c3-ili9341` | arduino | code / 893 | 1 / 9 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 320 | `c3-oled-i2c` | arduino | code / 1295 | 1 / 4 | failed | blocked | canonical_validation_gap, dependency_unverified, runtime_unavailable, unresolved_pin_layout |
| 321 | `c3-potentiometer` | arduino | code / 415 | 1 / 3 | passed | blocked | runtime_unavailable |
