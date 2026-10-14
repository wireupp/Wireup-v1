<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Canvas interaction and simulated Wi-Fi

Component dragging previews movement on every animation frame. Actual pin endpoints and rounded cable paths follow the same preview, while the canonical backend records one modification on release. Cancelling returns to the stored position. Simulation-running state prevents topology edits.

Selecting a wire highlights both real pin coordinates and labels the component/pin names. Its small connection card includes Show pin actions that center the viewport on an endpoint. Both keyboard selection and actual stroke clicking are supported. No voltage/current readings are fabricated.

For ESP32-C3/S3, selecting the board exposes Simulated Wi-Fi settings in its action toolbar. These SSID/password settings configure the official emulator's internal access point before firmware load. They are kept in page memory, not project storage or AI context. Actual C3 Arduino WiFi firmware associated with the configured access point during testing.

This is not physical router connectivity, wireless firmware uploading, or internet access. There is no host network proxy and no Bluetooth integration. Classic ESP32 remains unsupported by the official browser engine. The USB/serial Connect board & flash dialog is separate and requires explicit user confirmation.
