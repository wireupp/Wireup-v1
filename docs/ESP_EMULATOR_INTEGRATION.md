<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# ESP32 browser simulation integration

## Current scope

WireUp integrates the official Espressif **esp-emulator v0.48.0** WebAssembly release in a Web Worker for:

- `esp32-c3` / ESP32-C3 DevKitM-1
- `esp32-s3` / ESP32-S3 DevKitC-1

The existing arduino-cli compiler produces complete 4 MiB merged flash images. The adapter validates board/chip, partition layout, image segments, entry points and checksums before loading the pinned engine. The worker boots the embedded ROM and executes actual guest firmware. No source-text interpretation or fake blink generator is used.

UART0 text and coarse digital GPIO output/input are connected to the existing runtime and LED/button wiring. Start waits for engine load, stop terminates pending work, restart loads the real saved artifact, and project changes dispose the old worker. GPIO observations are 150 ms snapshots, not cycle-accurate external peripheral capture. USB CDC, PWM, addressable onboard LEDs, attached I²C/SPI sensor models and real networking are not integrated.

## Classic ESP32 remains blocked

`esp32-devkit-v1` and `esp32-devkit-c-v4` use classic Xtensa LX6 ESP32, which this release does not support. Velxio's existing full native GPIO lane requires compatible patched `libqemu-xtensa` binaries, ROMs, and its subprocess bridge. Those binaries are not installed in the current Windows environment. Generic QEMU, the C3 RV32 engine, and an S3 image are not substitutes. Compilation remains available; normal simulation remains disabled with an explicit reason.

Upstream native requirements and source distribution are documented in `vendor/velxio/docs/BUILD-QEMU.md`. Integrating that lane is remaining work, not claimed done by the C3/S3 browser integration.

## Assets and license

Source release: https://github.com/espressif/esp-emulator/releases/tag/v0.48.0

The downloaded WASM archive was checked against the release's `SHA256SUMS`. Original JavaScript/WASM and Apache-2.0 LICENSE are retained under `public/esp-emulator/pkg`. The worker is adapted from the pinned release with attribution. Public networking controls are intentionally absent. The public repository distributes the binaries and docs, not the full engine source tree.

## Verification

`tests/esp-emulator.spec.ts` compiles actual C3/S3 Arduino sketches, loads the merged image, observes setup/high/low serial output, checks external LED output, and restarts. Additional browser tests passed for real C3 button input, project-switch cleanup, startup asset failure reporting, and existing Uno potentiometer/servo/ultrasonic regressions. The C3/S3 tests also verify the external LED turns on and off from firmware GPIO. These checks do not establish edge-accurate PWM, networking, or attached sensor-bus support.
