<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Catalog integration status

## Build and wiring

All 157 upstream catalog entries were inspected in the actual registered Wokwi/Velxio custom elements with their default properties. The generated `backend/catalog/component-pins.json` contains 156 physical layouts and 1907 exact pin labels/coordinates. The wireless IR remote has no physical pins and remains non-connectable. Combined with additional board/source definitions, the backend catalog has 172 entries; 171 expose connectable pins.

Explicit existing board and component maps retain precedence. Extracted pin count is never inferred from metadata. The reproducible extractor and provenance hashes prevent guessing unavailable layouts. Wiring availability is not proof of physical electrical compatibility or simulation support.

## Added simulation

- 27 fixed passive presets: 11 resistors, 7 ceramic capacitors, 6 electrolytics and 3 inductors reuse the actual ngspice mapper. DC/transient tests verify exact defaults, polarity and numeric bounds. This is separate electrical analysis, not full MCU-to-analog feedback.
- Uno gas/flame/big-sound/small-sound sensors reuse original ADC models and real 0–1023 controls. Flame intensity is inverted. DOUT is only an upstream GPIO-driven LED indicator; no comparator behavior is invented.
- Uno analog joystick reuses its original two ADC axes and active-low switch, tested through real firmware.

Existing verified AVR/Pico peripherals, Uno displays/sensors and C3/S3 CPU/GPIO runtimes remain separate capability scopes.

## Not complete

Adding every visual component to the simulation allowlist would be false. Remaining logic gates, active semiconductor electrical models, motor-driver networks, UART peripherals, SPI device families and custom-chip integrations require their actual engine dependencies. `SIMULATION_INTEGRATION_BACKLOG.md` is a source inventory, and its historical counts must not be confused with current enabled counts.

No component is marked supported merely because it renders or has pins. Physical safety, current limits, power supply and board-specific voltage compatibility still require checks.
