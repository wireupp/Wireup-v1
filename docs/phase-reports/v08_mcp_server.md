# v08 — MCP server

## BASELINE

- Branch: `v2`.
- Before this continuation, `http://127.0.0.1:8000/docs` and `http://127.0.0.1:5173/` both returned HTTP 200.
- The reduced MCP project-edit smoke passed before the schema-description checks were added: it listed tools, created a temporary project, searched for an LED, added it, read it back, and deleted the project.
- `packages/toolbus` exists but the MCP bridge still delegates to the legacy hardware API instead of the bus. `contracts/capability.json` has `generator_status: "stub"`, and no headless runtime or trial/BOM service is exposed by this bridge.
- Full pre-change v08 verification suites: **NOT RUN**.

## TOOL_SURFACE

The stdio bridge exposes **24** indexed tools:

- Session/project lifecycle: 4
- Electronics project and wiring: 10
- Firmware/runtime: 8
- Capability discovery: 1
- Utility: 1

| Contract | MCP name |
|---|---|
| `session.create` | `session_create` |
| `capability.read` | `capability_read` |
| `project.create` | `project_create` |
| `project.read` | `project_read` |
| `project.delete` | `project_delete` |
| `read_project` | `read_project` |
| `search_components` | `search_components` |
| `add_component` | `add_component` |
| `remove_component` | `remove_component` |
| `modify_component` | `modify_component` |
| `connect_wire` | `connect_wire` |
| `remove_wire` | `remove_wire` |
| `check_connections` | `check_connections` |
| `generate_firmware` | `generate_firmware` |
| `read_firmware` | `read_firmware` |
| `edit_firmware` | `edit_firmware` |
| `compile_firmware` | `compile_firmware` |
| `run_simulation` | `run_simulation` |
| `stop_simulation` | `stop_simulation` |
| `read_simulation_results` | `read_simulation_results` |
| `read_compiler_errors` | `read_compiler_errors` |
| `calculator` | `calculator` |
| `wire_circuit` | `wire_circuit` |
| `validate_circuit` | `validate_circuit` |

## A3_TRANSCRIPT

The initial reduced MCP smoke transcript follows and predates the capability tool and session-bound resource additions. This is **not** the v08 A3 transcript: A3's firmware compile, headless run, telemetry, and BOM steps were not performed.

```text
> wireup@0.0.0 mcp:smoke
> node services/mcp/smoke.mjs

{"event":"mcp.tool","session_id":null,"actor":"agent","tool":"session_create","args_hash":"05fb4b846c080d8764b181e39779cb77add401f088b3188a979d87e0bf93ead5","result_code":"OK","duration_ms":2,"project_revision_before":null,"project_revision_after":null}
{"event":"mcp.tool","session_id":"72c36e4e-b1ba-40db-9f4d-7b4a944986af","actor":"agent","tool":"project_create","args_hash":"cc3c799f42d3d6b70a5c4bb616daf5543eec6042192838c240434246ec66df12","result_code":"OK","duration_ms":58,"project_revision_before":null,"project_revision_after":1}
{"event":"mcp.tool","session_id":"72c36e4e-b1ba-40db-9f4d-7b4a944986af","actor":"agent","tool":"search_components","args_hash":"d21eae028598bc7c9f16b3f88ad7de05db5cc6b940b1ea867854f7ccdf79bc3a","result_code":"OK","duration_ms":21,"project_revision_before":1,"project_revision_after":1}
{"event":"mcp.tool","session_id":"72c36e4e-b1ba-40db-9f4d-7b4a944986af","actor":"agent","tool":"add_component","args_hash":"0ac433a0a849ebd69678c3dde550eff4d1e3a7a375dd4a3c609b544616388e42","result_code":"OK","duration_ms":10,"project_revision_before":1,"project_revision_after":2}
{"event":"mcp.tool","session_id":"72c36e4e-b1ba-40db-9f4d-7b4a944986af","actor":"agent","tool":"read_project","args_hash":"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","result_code":"OK","duration_ms":17,"project_revision_before":2,"project_revision_after":2}
MCP smoke passed: 23 indexed tools and schemas verified; created and read project a9391c79af274699ab33368085caa75a; added led.
{"event":"mcp.tool","session_id":"72c36e4e-b1ba-40db-9f4d-7b4a944986af","actor":"agent","tool":"project_delete","args_hash":"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","result_code":"OK","duration_ms":6,"project_revision_before":2,"project_revision_after":null}
```

## SECURITY

- The MCP process uses stdio and starts no network listener. `WIREUP_API_URL` defaults to loopback and non-loopback URLs are rejected.
- The existing API requires a bearer token in production; requests are loopback/origin guarded, bodies are capped at 600,000 bytes, and expensive requests have a default concurrency limit of four.
- Session runtime tokens stay in the MCP process and are passed only to the local API where needed. Project responses scrub token-like fields and bearer strings.
- MCP audit output contains the session id, tool name, argument hash, result code, duration, and revisions; it does not log raw tool arguments.
- `capability_read` returns the same document as `wireup://capability`, including the current `generator_status`; it does not synthesize support.
- Project resource reads now require a session id bound to that project. The smoke verified that the bound read succeeds, unscoped and cross-session reads fail, and the session-bound resource reflects the subsequent edit.
- HTTP 409 responses are mapped to `REVISION_STALE` with explicit re-read/retry guidance; HTTP 429/session rate limits identify `RATE_LIMITED` as retryable. Missing or expired session IDs map to `SESSION_EXPIRED`.
- `review_approved:true` remains a caller assertion, not a server-verifiable human approval; the agent guide now states that MCP clients/deployments must enforce confirmation.
- The smoke confirmed no runtime token was returned in the created or read project. It did not inspect process sockets or run the full A3 secret-hygiene capture.

## ACCEPTANCE

| Assertion | Command / evidence | Result |
|---|---|---|
| A1 — exact registered tool surface | `npm run mcp:smoke` verifies the 24 listed names match `contracts/tools/index.json` and follow the dot-to-underscore rule | **PARTIAL** — the MCP bridge still does not derive its surface from the ToolBus registry |
| A2 — contract-derived descriptions and schemas | `npm run mcp:smoke` verifies every indexed output schema, summary, argument field, error and `see_also` entry | **PASS** |
| A3 — Uno, LED, resistor, firmware, headless run, telemetry, BOM | Not run; no headless runtime, telemetry/trials, or BOM service is available through the bridge | **FAIL** |
| A4 — three deterministic full A3 runs | **NOT RUN**; A3 is unavailable | **FAIL** |
| A5 — stale-revision recovery | MCP smoke uses a second session bound to the same project: stale `expected_revision` returns `isError:true`, `_meta.code:"REVISION_STALE"`, and re-read guidance; re-reading and retrying succeeds | **PASS** |
| A6 — unavailable-mechanics response | **NOT RUN**; solver registry/capability generation is absent | **FAIL** |
| A7 — session isolation | Smoke creates separate projects and confirms a session cannot read the other project's data; it also binds a second session to one project, verifies a stale write is rejected, re-reads, and succeeds on retry | **PASS** for the exercised sequential stale-write and project-isolation cases; simultaneous interleaving **NOT RUN** |
| A8 — session expiry | Smoke verifies an unknown/expired session returns `_meta.code:"SESSION_EXPIRED"` and does not create a replacement; timed TTL expiry **NOT RUN** | **PARTIAL** |
| A9 — full-run secret and source hygiene | Reduced smoke returned no project runtime token and emitted argument hashes; full A3 capture not run | **PARTIAL** |
| A10 — no stdio listening socket | Server starts only `StdioServerTransport`; socket-inspection test **NOT RUN** | **PARTIAL** |
| A11 — rate-limit retry behavior | **NOT RUN** | **FAIL** |
| A12 — agent-guide resource and tool-name consistency | Smoke verifies the build prompt points to the guide resource, checks capability tool/resource equality, and checks the prompt's available capability/project/catalog sequence plus no-headless-runtime disclosure; guide retrieval and full tool-name consistency assertion **NOT RUN** | **PARTIAL** |

## EXISTING_TESTS

- `node --check services/mcp/server.mjs`: **PASS**.
- `node --check services/mcp/smoke.mjs`: **PASS**.
- `npm run mcp:smoke`: **PASS**; 24 indexed tools and schemas checked, capability tool/resource equality verified, build prompt guidance checked, unknown-session handling and bound/unscoped/cross-session resource access checked, and cross-session stale-write recovery verified on two temporary projects.
- `npm run build`: **NOT RUN**.
- `npm run lint`: **NOT RUN**.
- `npm run core:test`: **NOT RUN**.
- `npm run contracts:check`: **NOT RUN**.
- `node bench/run.mjs`: **NOT RUN**.
- `node scripts/python.mjs -m pytest backend/tests -q`: **NOT RUN**.
- `npm test -- --workers=1`: **NOT RUN**.

## ESCALATION

**RED** — capability discovery and session-bound project resources are verified, but the v08 A3 loop and its dependent guarantees remain unavailable because the ToolBus integration and v05–v07 services are incomplete. Do not claim v08 complete until those prerequisites and the headless acceptance loop are implemented and verified.

## GAPS

- MCP currently delegates directly to the legacy hardware API, not `packages/toolbus`; mutation parity with the UI/toolbus is therefore not established.
- A3 and the deterministic, headless simulation, telemetry, trial, and BOM acceptance criteria remain blocked by missing v04–v07 services.
- The MCP bridge does not provide the required scoped per-session auth token, `session.release`, or streamable HTTP transport.
- Review-gated MCP tools still rely on a caller-provided boolean and are not backed by a server-verifiable approval record. Do not treat that flag alone as completed human review.
- Simultaneous cross-session mutation interleaving, timed TTL expiry, rate-limit saturation, and socket inspection remain unverified.
- `contracts/capability.json` is still a stub; mechanics capability reporting cannot be validated.

## DEVIATIONS

- Implemented the limited stdio-to-loopback legacy API bridge instead of the specified shared toolbus core. This provides a working MCP edit/read path for local testing without claiming the absent headless/runtime capabilities.
- Added a focused smoke test for actual project creation, LED placement, read-back, cleanup, contract-derived names, descriptions, and schemas; it does not replace or narrow the A3 acceptance criteria.
