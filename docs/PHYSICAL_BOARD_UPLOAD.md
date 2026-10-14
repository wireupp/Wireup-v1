<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Connect and flash an actual board

The workspace footer provides **Connect board & flash**. Plug in the board with a data-capable USB cable, open the dialog, refresh detected serial ports, select the intended device, and confirm that its firmware may be replaced.

The backend uses the installed arduino-cli uploader. Device discovery is actual `arduino-cli board list --format json`; unknown serial ports are not certified as a particular board. The user must select the correct physical device. Known mismatched FQBNs are rejected.

Current supported upload targets are Arduino AVR and ESP32 families. Pico and Linux Raspberry Pi physical upload are not implemented by this endpoint. Use their normal external deployment flow; CPU simulation availability does not imply upload support.

Save and successfully compile first. Upload uses only the server's current compiler artifact, not client-supplied binaries, executables, or board identifiers. AVR uploads use the verified HEX artifact. ESP uploads reconstruct the compiler's exact flash segments and boot metadata from its merged image. Revision/source/board checks, port rediscovery, project/port locks, local-only access, bounded process output, 120-second timeout and cancellation cleanup are enforced.

The dialog requires explicit confirmation. The AI has no physical upload tool. Uploader success is displayed only from the real process result, and physical behavior must still be verified manually.

Verification covers API safety, stale/mismatched artifacts, absent devices, concurrency, cancellation, and browser confirmation flow using controlled uploader responses. Actual serial ports were detected, but no physical board was flashed during implementation.
