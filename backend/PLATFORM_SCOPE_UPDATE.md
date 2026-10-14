<!-- Parent document: docs/ARCHITECTURE.md --><!-- Phase reports: docs/phase-reports/ -->
# Latest frontend scope update

User explicitly rejects current stacked tiny circuit/code/compiler layout (005316.png). Wants reference 005529.png, 005714.png: main large circuit canvas + left categorized visual component catalog + right agent + compact bottom console; Sketch toggle opens code, schematic mode, sources including DC SPICE, oscilloscope/logic analyser. NO Builder/Studio switch. Parent will implement full visual followup after current worker completes; avoid further changing layout once tests done report so parent can own. Core must now merge fuller upstream simulator not placement-only parts.

Parent PlatformHome / creates project from prompt initialPrompt -> embedded ChatApp auto-submits scoped agent. /projects redirect / and /assistant legacy chat. App wired HardwareWorkspace chatSlot/onProjectChange. Existing hardware tests use /project. Goto load/font requests problematic use domcontentloaded. Parent screenshot board clipped due y100 + small canvas; must improve.

Parent live compile browser verification failed: Run remained disabled after compile 90sec. Need inspect real compiler status and artifactIsCurrent vs revision; parent investigating too. Backend worker added multiple boards with artifact .program not just hex possibly. Do not claim working browser simulation until real D13 transitions proven.

Aliases @pro/@velxio configured, all upstream deps + public boards/catalog/wasm/monaco assets installed. Recommendation full upstream SimulatorCanvas/useSimulatorStore/CodeEditor + spice/start mounted; parent can followup. Current direct AVR runtime limited external parts, user explicitly wants actual spice/instruments missing.
