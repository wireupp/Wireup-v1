# Release status

Authoritative short list of what is verified and what is blocked. The full architecture is
`docs/ARCHITECTURE.md`; per-phase detail is in `docs/phase-reports/`.

## Verified locally

- Canonical project persistence, integer revisions, board/pin validation, atomic additive wiring,
  bounded undo, limited rail/LED topology checks.
- LangGraph agent with 24 tools, real ngspice DC/transient, real Arduino compilation, real AVR and
  RP2040 CPU emulation, oscilloscope and logic analyser.
- Circuit canvas, schematic studio, breadboard view, build guide, examples gallery.

## Not ready — open blockers

1. **MCP is a local legacy bridge, not the completed ToolBus transport.** It exposes the
   existing electronics API; the unified mutation path and headless execution are incomplete.
2. **Simulation requires a browser.** An external agent cannot run or observe anything without
   an attached browser runtime. Sequenced as phase v07.
3. **Single domain.** The project model is electronics-only. No boat, drone or website domain.
   Sequenced as phase v03.
4. **Compiler is not sandboxed.** Native compilation runs in-process. Must be isolated before any
   untrusted or public firmware is accepted.
5. **No per-user auth.** Shared-token reference auth is not identity or project authorization.
6. **ESP32-C3 native runtime fails** in execution (PC 0x514c26). Not advertised as working.
   Pico W radio (CYW43) and onboard LED unsupported.
7. **Remote ESP32 QEMU** is packaged but not deployed; Docker, TLS and QEMU execution unverified.
8. **AGPL obligations.** The vendored Velxio tree is AGPLv3 / commercial dual-licensed. A licensing
   decision is required before closed-source distribution. See `vendor/VELXIO_PROVENANCE.md`.

## Confidence

Local features above are exercised by the test suites. Provider-dependent behaviour (Groq,
NVIDIA, Azure, Bedrock) is verified only where a live call was made; quota and access problems are
environmental, not product defects, and are reported as such.