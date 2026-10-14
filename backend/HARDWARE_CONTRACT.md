<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Hardware API contract

Integration: `from backend.hardware import router, service` and `application.include_router(router)`; app.py is intentionally not changed by the hardware worker. Agent tools call `await service.command(project_id, name, args, runtime_token=runtime_token)` and use the same canonical service as manual REST edits. `HardwareService(data_dir=Path(...), compiler=ArduinoCompiler(...), runtime=RuntimeBridge(...))` supports isolated tests.

- `POST /api/hardware/projects` body `{ "name": "Untitled circuit", "board": "arduino-uno" }` returns the canonical project (including its generated `runtime_token`). Default board and source remain Arduino Uno Blink. Supported project board IDs now also include `arduino-nano`, `arduino-mega`, and `pi-pico`; see the board extension below.
- `GET /api/hardware/projects` returns `{ "projects": [...] }`; `GET /api/hardware/projects/{id}` returns the complete project.
- `GET /api/hardware/catalog?q=...&limit=50` returns `{ "components": [...], "boards": [...] }` (also available through search_components).
- `POST /api/hardware/project/{id}/command` body `{ "name": "...", "args": {...}, "runtime_token": "..." }` returns the tool result directly. Errors use FastAPI `{ "detail": "..." }` with 400 validation, 404 missing item, 409 stale revision/session conflict, 503 missing runtime/compiler, 504 timeout.

Project shape: `{id, schema_version:1, revision, name, board, components:[{id,type,x,y,rotation,properties}], wires:[{id,from:{component,pin},to:{component,pin},color}], firmware:{filename:"sketch.ino",source,revision}, history:[{revision,operation,...}], compiler:null|{status,source_revision,project_revision,stdout,stderr,artifact}, runtime_token, created_at, updated_at}`. An artifact is `{id,format:"hex",board,source_revision,project_revision,source,hex,url}`; `hex` is the actual Intel HEX file contents and `url` is a backend artifact download endpoint. Compilation success means `simulation_ready`, NOT that a simulator is running.

Mutations accept optional `expected_revision` (recommended for both UI and agent); mismatches fail with 409. Every successful mutation increments project revision and persists. Source edits also increment `firmware.revision`; undo always creates a new project revision. Responses to mutations are the complete project. Source snapshots and original source/project revisions remain on compiler results even if later edits make them stale.

Tool operations (the domain tool set is exactly these 16; undo is an extra manual command):

1. read_project `{}`
2. search_components `{query?:string,limit?:number}`
3. add_component `{type:string,id?:string,x?:number,y?:number,rotation?:number,properties?:object,expected_revision?:number}`
4. remove_component `{id:string,expected_revision?:number}` (removes incident wires)
5. modify_component `{id:string,x?:number,y?:number,rotation?:number,properties?:object,expected_revision?:number}`
6. connect_wire `{from:{component:string,pin:string},to:{component:string,pin:string},color?:string,id?:string,expected_revision?:number}`
7. remove_wire `{id:string,expected_revision?:number}`
8. generate_firmware `{source:string,expected_revision?:number}` writes supplied model source; never invents firmware on the server.
9. read_firmware `{}` returns firmware object.
10. edit_firmware `{source:string,expected_revision?:number}` replaces source; alternatively `{old:string,new:string,expected_revision?:number}` makes one exact replacement.
11. compile_firmware `{expected_revision?:number}` returns compiler result, real artifact, diagnostics, and source snapshot.
12. run_simulation `{artifact_id?:string}` requires matching runtime_token and a connected browser; uses the latest current-revision artifact by default.
13. stop_simulation `{}` requires runtime_token and browser acknowledgement.
14. read_simulation_results `{}` requires runtime_token and browser acknowledgement; never fabricates measurements.
15. read_compiler_errors `{}` returns the latest compiler result or `{status:"not_compiled",errors:[]}`.
16. calculator `{expression:string}` returns `{expression,result}` using a bounded numeric AST.

Extra manual command: undo `{expected_revision?:number}`.

Websocket: `/api/hardware/project/{id}/runtime?token=<project.runtime_token>`. The project token owns its one browser session; missing/wrong token closes with 4403, second owner session with 4409. On connect server sends `{type:"runtime_connected",project_id}`. Commands sent to browser are `{type:"command",id:<correlation UUID>,name:"run_simulation"|"stop_simulation"|"read_simulation_results",args:{...},project_id}`. Run args include `{project:<canonical snapshot>,artifact:<actual hex artifact>}`. Browser MUST acknowledge `{type:"ack",id,ok:true,result:{...}}` or `{type:"ack",id,ok:false,error:"..."}`. `run_simulation` should acknowledge only after the emulator actually starts. Reads should return real serial/pin/runtime values. Unknown/late IDs do not satisfy pending commands. REST/agent response is `{status:"acknowledged",command,id,result}`; no browser -> 503, disconnected -> 503, no ack within bounded deadline -> 504. Browser runtime state is not claimed by compilation.

Compiler discovery: `ARDUINO_CLI_PATH`, PATH, then `C:/Program Files/Arduino CLI/arduino-cli.exe`. Installed environment has Arduino AVR core 1.8.8. All CLI arguments are server-controlled, no shell, sketch name is fixed, compilation uses a temporary directory and bounded asynchronous subprocess lifecycle. Catalog loads `vendor/velxio/frontend/public/components-metadata.json`; exact known pins supplement generated entries, whose metadata only contains pinCount. Unknown pin layouts are explicitly non-connectable, not guessed.

Tests in `backend/tests/test_hardware.py` use an isolated service/router, fake compiler subprocess and browser acknowledgements, plus an actual installed-CLI Blink compilation when available. Coverage includes persistence, atomic optimistic revisions/undo, catalog pins/property normalization, source edits, unsafe calculator/source/path rejection, diagnostics and stale artifacts, runtime authorization/cross-project tokens/ownership/correlation/no-browser/timeouts/disconnection, and compiler timeout/output limits/cancellation. Compiler concurrency is one process with a bounded 10-second acquisition wait; a browser session has at most 32 pending commands. Compiler availability/timeout errors persist diagnostics before returning their HTTP error. ESP32 remains unavailable without configured QEMU. Board support was extended additively as described below.

Initial Uno verification: `.venv/Scripts/python.exe -m pytest backend/tests/test_hardware.py -q` passed all 33 tests, including real Windows Arduino CLI Blink compilation. Browser bridge protocol was verified with TestClient browser acknowledgements; an actual frontend emulator session remains the parent's integration responsibility.

## Additive board extension

No route, tool name, default board, revision, or acknowledgement shape changed. Each project still has exactly one selected board. Select it at project creation; a second board cannot be added as a component. This proves support for multiple board types, not multiple MCUs in one circuit.

| Project board ID / element tag | Compiler FQBN (server controlled) | Artifact | Browser loader |
| --- | --- | --- | --- |
| `arduino-uno` / `wokwi-arduino-uno` | `arduino:avr:uno` | `format:"hex"`, `hex`: Intel HEX text | upstream `AVRSimulator(pm, 'uno').loadHex(artifact.hex)` |
| `arduino-nano` / `wokwi-arduino-nano` | `arduino:avr:nano:cpu=atmega328` | `format:"hex"`, `hex`: Intel HEX text | same ATmega328P/16MHz Uno variant |
| `arduino-mega` / `wokwi-arduino-mega` | `arduino:avr:mega:cpu=atmega2560` | `format:"hex"`, `hex`: Intel HEX text | upstream `AVRSimulator(pm, 'mega').loadHex(artifact.hex)`; Uno-only direct runtime MUST NOT claim Mega execution |
| `pi-pico` / `wokwi-pi-pico` | `rp2040:rp2040:rpipico` | `format:"bin"`, `bin`: base64 raw flash bytes, `encoding:"base64"`, `load_address:268435456`, `size_bytes` | upstream `RP2040Simulator(pm).loadBinary(artifact.bin)` then `start()` |

`RP2040Simulator.ts:836-852` explicitly consumes base64 raw Arduino CLI `.bin`; `initMCU` loads bootrom B1, copies raw image to flash offset 0, and sets PC to `0x10000000`. The `.bin` includes the 256-byte second-stage bootloader; the service validates its following vector-table stack and entry addresses. Default compile deadlines are 90 seconds for AVR and a bounded 300 seconds for Pico's larger cold core build; an explicit ArduinoCompiler(timeout=...) overrides both. It is NOT UF2 and must not be passed to a UF2 parser or named `.uf2`. Artifact download returns decoded binary `application/octet-stream` with `sketch.ino.bin`; AVR download remains text `sketch.ino.hex`. Artifacts retain `source`, original revisions, and now the actual `fqbn`. Compiler results add `compile_source` (exact temporary sketch bytes as text). To match upstream RP2040 Arduino mode's UART terminal, Pico compilation prepends `#define Serial Serial1\n` while preserving the original canonical source. Hardware USB CDC is not promised by this mode.

Catalog `pins` lists physical element/header labels: Nano D0-D13 are named `"0"`-`"13"`, analog A0-A7 plus exact reset/power/ICSP labels; Mega has `"0"`-`"53"`, A0-A15, SDA/SCL and exact power labels. AVR labels were checked against installed `@wokwi/elements/dist/esm/*-element.js`. Pico exposes 40 header pins: GP0-GP22, GP26-GP28, GND.1-GND.8, RUN, ADC_VREF, 3V3, 3V3_EN, VSYS, VBUS. GP23/24/25/29 are not connectable header pins; GPIO25 is still the onboard LED. Uno's former Dn/GND/TX/RX aliases remain accepted on incoming wires but normalize to actual catalog pins; `pin_aliases` documents these separately. Uno also accepts A4.2/A5.2. Never infer pins from pinCount. Unsupported vendor boards remain visible for search with `supported_board:false`, `compile:false`, `simulation:"unavailable"`, and an unavailable reason; ESP32 requires QEMU.

`simulation:"browser"` means a supported bridge/loader contract, not that the currently connected frontend implements the board. The browser must reject unsupported board commands (`ok:false`) rather than acknowledge a placement-only view or call the Uno emulator for Mega/Pico. Compilation alone remains `simulation_ready`. Parts with a visual element/pins are not automatically electrically simulated; frontend capability labels must distinguish placement from actual event handlers.

## Local token security audit

The existing contract intentionally returns `runtime_token` on project create/get/mutation/read_project so a local UI can reconnect after restart. It is a browser-session ownership capability, NOT a login credential or public multi-user authorization system. Tokens remain plaintext in private `backend/data/hardware/*.json`; protect that directory with OS user ACLs, never serve it as static files, and do not publish project JSON or use it as model context without removing `runtime_token`. `list_projects` omits tokens; browser command project snapshots now omit tokens as they are already authenticated.

All hardware REST routes require a loopback peer and loopback Host, and any supplied Origin must be HTTP(S) loopback. They return no-store and no-referrer on successful responses. Websockets enforce the same local guard plus the matching project token; a remote Origin is closed with 4403. TestClient synthetic hostnames are allowed for isolated tests. Forwarded headers are not consulted by this module. Parent must keep uvicorn bound to 127.0.0.1, disable untrusted proxy-header rewriting, avoid publishing a localhost reverse proxy/tunnel, and redact websocket query strings from access logs; the preserved query-token contract can otherwise leak tokens to log readers. Any local process/browser origin can still act as the same OS user. Real public deployment needs application authentication, per-project authorization, origin allowlisting, and a separate one-time websocket credential design before exposure.

## Canonical upstream state integration guidance

Use the existing 16 command operations for BOTH manual and agent changes, serialize edits, and submit the last returned `expected_revision`; replace the local canonical snapshot with each successful response. On 409, reload and reconcile rather than overwrite. Translate upstream component `position` to x/y and wire `{start:{componentId,pinName},end:{...}}` to canonical `{from:{component,pin},to:{...}}`, preserving IDs and using exact catalog pins. Keep board instance ID `board`. Drag saves should commit on gesture completion; runtime measurements and temporary hover state are not mutations. Source changes go through edit_firmware/generate_firmware, not browser-local source alone. Compile only the latest acknowledged canonical project and reject stale artifacts.

No wholesale upstream-state replacement endpoint is introduced: accepting an unvalidated blob would bypass pins/properties, revisions, undo, and token ownership. Upstream custom-chip, SD files, multiple MCU boards, and component-specific fields absent from the catalog require a future validated/versioned schema extension; do not silently drop them or claim they persist. A future atomic batch command could validate all existing operations against one snapshot and create one revision/undo entry, but this extension is not implemented here.

Extension verification: `.venv/Scripts/python.exe -m pytest backend/tests/test_hardware.py -q` passed all **46 tests** in 120.47 seconds, including real installed Windows Arduino CLI Blink compilation for Uno, Nano, Mega 2560, and Pico. Pico binary flash-vector addresses were checked, and all multi-board bridge tests awaited browser acknowledgements. `py_compile backend/hardware.py` passed. The first Pico attempt exceeded the old 90-second limit; cancellation worked, then the explicit bounded Pico deadline was added and real compilation passed. Actual frontend Mega/Pico emulator execution is not claimed by these backend tests.
