<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Classic ESP32 native QEMU integration

## Installed runtime

Official Espressif QEMU release `esp-develop-9.2.2-20260417`, Windows x86_64 Xtensa package, installed under `vendor/qemu/qemu`. The download was verified against the release SHA256 list. The executable reports QEMU 9.2.2. Upstream GPL notices remain in the package; this is not Velxio's additional patched shared-library ABI.

## Backend implementation

`backend/native_esp32.py` starts a bounded native process from the server's current complete merged artifact for `esp32-devkit-v1` / `esp32-devkit-c-v4`. It reuses compilation, runtime tokens, board/source/project revision validation and current-artifact checks. No client executable, image path, networking configuration or GDB listener is accepted. Temporary images, bounded UART buffers, concurrency limits, cancellation, stop and shutdown cleanup are owned by the backend.

Native API/run command support is diagnostic and is not advertised as full circuit simulation. GPIO is explicitly unavailable; no LED outputs are inferred from source code or serial text. Guest panic output is reported as an error and the process is stopped.

## Actual verification result

Two actual arduino-cli classic ESP32 merged images were run: an original OLED example and a minimal Serial-only sketch. ROM/second-stage boot output appeared, but both hit a cache-error Guru Meditation before user `setup()`/`loop()` completed. The minimal sketch produced neither CLASSIC_SETUP nor CLASSIC_LOOP. Documented watchdog disabling and single-core variants did not produce a successful application boot.

The official source `hw/gpio/esp32_gpio.c` in the inspected branch implements strap-register reads and an empty GPIO write callback, not Velxio's external GPIO bridge. It cannot currently drive the visible circuit through the expected shared-library callbacks.

**Classic ESP32 simulation therefore remains disabled in normal Wireup controls.** The backend integration is present for further compatibility work, but installation alone is not evidence of support. Existing C3/S3 official-WASM and AVR simulation paths are unaffected.

## Next blocker

Resolve the Arduino-core/IDF image compatibility with this QEMU release, or supply/build the compatible patched Velxio native libraries and ROM integration. Full external GPIO/I²C/SPI remains separate even after UART boots. Do not change a board ID to C3/S3 or mark the guest running merely because its process is alive.
