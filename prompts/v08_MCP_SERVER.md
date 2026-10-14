# v08 — MCP SERVER

**Goal:** the loop closes. An external AI agent — Claude Code, Codex, anything with an MCP client —
connects, discovers what the platform can do, and builds and tests projects through tools, with no
browser and no chat UI.

This is the phase the entire product vision rests on. If it ships, the rest of the platform has a
driver. If it does not, everything so far is a very good circuit simulator.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0 and §3. **I1 single mutation path** — the MCP server is a transport
adapter and nothing else. It contains no domain logic, no validation the tool bus does not already
do, and no behaviour the UI cannot trigger.

**Never expose a tool the UI cannot also call.** Every MCP tool maps 1:1 to a `contracts/tools/`
entry with a registered handler.

---

## 1. Context

The upstream vendored project (`vendor/velxio`) contains an MCP implementation
(`vendor/velxio/backend/app/mcp/server.py`, `vendor/velxio/docs/MCP.md`) that was never adopted.
Read it for prior art and for the client's expectations, but **do not copy it**: it is AGPL-licensed
vended source, tied to a different domain model, and predates the tool bus.

By now the platform has: contracts (`v02`), the graph (`v03`), the tool bus (`v04`), telemetry and
trials (`v05`), honest capability (`v06`), and a headless runtime (`v07`). All that is missing is
the wire.

---

## 2. Preconditions — verify, do not assume

1. `packages/toolbus` is complete and `v04`'s parity assertions pass.
2. `scripts/gen-capability.mjs` produces a real `contracts/capability.json` with
   `generator_status:"generated"`.
3. `npm run contracts:check`, `npm run core:test`, `npm run build`, `npm run lint` all pass.
4. Read `vendor/velxio/docs/MCP.md` and `vendor/velxio/backend/app/mcp/server.py`. Record what
   conventions an MCP client expects (tool naming, `resources`, `prompts`, error shapes).
5. Read `backend/security.py` in full. Record the loopback guard, the production-mode token
   requirement, request admission limits, and body size limits. These constrain the transport.

---

## 3. What to build — `services/mcp/`

### 3.1 `server.ts`

Use the official MCP TypeScript SDK. Two transports:

- **stdio** — `wireup-mcp`, for desktop agents (Claude Code, Codex CLI). The process is spawned by
  the client. Environment is scrubbed of everything except `WIREUP_*` variables.
- **streamable HTTP** — for remote/hosted agents, mounted on the existing FastAPI app at
  `/mcp`, behind the existing security middleware.

One `createServer(deps)` core shared by both. No behaviour difference between transports.

### 3.2 `tools.ts` — generated from contracts

Tool list is built at startup from `contracts/tools/` + the registry. Per tool:

- `name`: the contract name (`component.add` → `component_add` is **not** used; MCP tool names must
  be `[a-zA-Z0-9_-]{1,64}`, so map `node.add` → `node_add` deterministically and document the
  mapping in the tool description). Legacy names are accepted as aliases for one release.
- `description`: composed from the contract — `summary`, the `args` schema in prose, `result`, every
  documented `errors[]` with its `when`, and the `see_also` links. **This text is the model's entire
  understanding of the tool.** Write it well and mechanically; do not hand-write per-tool prose
  that can drift.
- `inputSchema`: the contract's `args` JSON Schema, verbatim.
- `outputSchema`: the contract's `result`, verbatim.
- Annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint` derived from the contract's
  `mutating` and the operation. `destructiveHint:true` for `node.remove`, `edge.remove`,
  `project.delete`, `runtime.stop`.

Handlers are `ctx => toolbus.invoke(name, args, ctxToToolContext(ctx))`. Nothing else.

### 3.3 `context.ts` — session and project binding

MCP clients are stateless between calls. WireUp projects are not. Therefore:

- `session.create { profile?, project_id?, ttl_seconds? }` → `{ session_id, token, project_id,
  capabilities, expires_at }`.
- Every subsequent call carries `{ session_id }`. The server resolves it to a `ToolContext` with
  `actor:{kind:"agent", id, sessionId}`, `store`, `services`, `deadlineMs`, `signal`.
- A session is **bound to one project**. An agent wanting a new project calls `session.create`.
- Sessions expire (default 60 min, configurable, hard-capped). An expired session returns
  `SESSION_EXPIRED`, never a silent re-creation.
- `session.release` closes it and terminates any run it owns.

Rate limits per session, mirroring the existing `429` behaviour.

### 3.4 `resources.ts` — read-only context

Expose as MCP **resources**, not tools, so clients can list and read them without spending turns:

- `wireup://capability` — the generated capability document.
- `wireup://contracts/tools/{name}` — the raw contract.
- `wireup://project/{id}` — the current graph.
- `wireup://project/{id}/bom`
- `wireup://trial/{id}` — trial result plus recording metadata.
- `wireup://telemetry/{trial_id}/channels` — channel list with units and quality.
- `wireup://docs/ARCHITECTURE`, `wireup://docs/agent-guide` — a **new, short**
  `docs/AGENT_GUIDE.md`, written in this phase, covering: how to start, the tool order for common
  tasks (build a circuit; build something mechanical; build software), the honesty rules
  (`capability.read` first, never claim un-simulated behaviour), the review flow, and what to do
  when a tool errors. Aim for 150 lines. This document is what an agent reads instead of your
  source code, so its quality determines agent quality.

### 3.5 `prompts.ts`

Two MCP **prompts**, both thin and mechanical:

- `build_project` — `{ goal, domain?, constraints? }` → a short instruction that points at
  `wireup://docs/agent-guide` and states the mandatory sequence: `capability.read` →
  `session.create` → `project.create` → `catalog.search` → build → `firmware.compile` →
  `runtime.run` (headless) → `trial.sweep` → `bom.build`. **No prose about electronics.** The agent
  gets specifics from the tools.
- `diagnose_failure` — `{ project_id, trial_id }` → instructions to read the recording, the error
  codes, and the `contracts/derivations.json` entries involved, and to report honestly rather than
  retry blindly.

### 3.6 Auth and transport security

- stdio: no network listener at all. Assert this in a test.
- HTTP: reuse `backend/security.py`. In production mode, require a bearer token; issue scoped tokens
  per session; never log them; never return them inside a tool result (the `create` result is the
  only place the token appears, once).
- Bind HTTP to loopback by default. Remote exposure is a documented deployment decision, not a
  default.
- Every tool call is logged to an audit record: `{ session_id, actor, tool, args_hash, result_code,
  duration_ms, project_revision_before, project_revision_after }`. **Args hash, not args** — args
  may contain user source. No secrets, ever.

### 3.7 `client/` — a reference client

`services/mcp/client/reference.ts` — a tiny stdio client used by the bench and by
`v15_WORLD_ACCEPTANCE`. It must be able to: list tools, call them, read resources, and stream. It
exists so the acceptance tests do not depend on a third-party agent.

### 3.8 Error mapping

| Bus `ToolError.code` | MCP behaviour |
|---|---|
| `REVISION_STALE` | `isError:true`, message tells the agent to re-read the project and retry |
| `UNKNOWN_KIND`, `INCOMPATIBLE_PORT`, `SCHEMA` | `isError:true` with the offending id in `details` |
| `NOT_IMPLEMENTED` | `isError:true` naming the phase that owns the feature |
| `SOLVER_UNAVAILABLE` | `isError:false` with `capability` context attached — this is **not** a failure, it is an answer |
| rate limit / deadline | `isError:true` with `retryable:true` |

Never return a stack trace. Never return a token.

---

## 4. Files

**Create:** `services/mcp/**`, `docs/AGENT_GUIDE.md`,
`bench/cases/meta/mcp/**`, `contracts/tools/index.json` (the name mapping).

**Modify:** `backend/app.py` (mount `/mcp`, register the audit sink), `backend/security.py` (token
scoping only — do not weaken anything), `package.json`, `docs/ARCHITECTURE.md`, `AGENTS.md`
(section pointing at `docs/AGENT_GUIDE.md`).

**Do not touch:** `packages/toolbus/**` handlers (only the registry if a tool needs a context
field), `src/**`, `backend/agent/**`, `vendor/**`.

---

## 5. APPROVED DEPS

- `@modelcontextprotocol/sdk`

Nothing else. Do not add an agent framework here — `v09` may, this phase may not.

---

## 6. Acceptance criteria

- **A1** The stdio reference client lists tools and the list is exactly the registry's tools mapped
  by the documented naming rule. A contract without a handler does not appear; a handler without a
  contract does not appear; the server refuses to start otherwise.
- **A2** Every tool description contains: the summary, every `args` field, every `errors[]` entry,
  and the `see_also` links. Assert by parsing all descriptions.
- **A3** **The critical test:** the reference client, using **no** chat UI and **no** browser,
  creates a project, adds an Uno + LED + resistor from `catalog.search`, writes firmware, compiles,
  runs headless, reads telemetry, and builds a BOM. Every step through MCP only. This is the loop.
- **A4** Determinism: A3 repeated 3 times produces byte-identical telemetry recordings and an
  identical BOM (modulo ids).
- **A5** A tool erroring with `REVISION_STALE` returns `isError:true` and the agent can recover by
  re-reading and succeeding on retry — proven by a scripted client.
- **A6** Calling a `mechanics` capability on an unbuilt solver returns `SOLVER_UNAVAILABLE` with
  `requiredToSupport`, as a non-error answer. Prove an agent can build a plan around it.
- **A7** Session isolation: two sessions on the same project cannot interleave a mutation —
  the second gets `REVISION_STALE`. Two sessions on different projects never see each other's data.
- **A8** Session expiry: an expired session returns `SESSION_EXPIRED` and does not silently create
  a new one.
- **A9** **Secret hygiene:** an audit-log capture from a full A3 run contains no token, no API key,
  and no raw firmware source in `args` (hashes only). Assert all three.
- **A10** stdio transport opens no listening socket. Assert by inspecting the process's sockets in a
  test.
- **A11** Rate limiting: exceeding the documented limit returns a retryable error, not a crash.
- **A12** `wireup://docs/agent-guide` is retrievable and its guidance matches the actual tool names
  (assert every tool name mentioned in it exists).

---

## 7. Verification

```powershell
npm run build
npm run lint
npm run core:test
npm run contracts:check
npm run mcp:smoke
node bench/run.mjs
node scripts/python.mjs -m pytest backend/tests -q
npm test -- --workers=1
```

`npm run mcp:smoke` is a new script that runs the reference client through A3 and exits non-zero on
failure. It must pass before this phase is complete.

---

## 8. Out of scope

- The autonomous agent loop. `v09`. The MCP server exposes tools; it does not think.
- Multi-tenant accounts, quotas, billing, or a hosted public deployment.
- OAuth, SSO, or any identity provider.
- Streaming telemetry to a live UI over MCP.
- Any new solver. `v11`, `v12`.
- Deleting the vendored Velxio MCP code.

---

## 9. If you are blocked

If the official SDK does not support a capability the transport needs (streaming, resource
subscriptions), implement the closest supported thing and record the gap. **Do not fork the SDK.**

If A3 fails anywhere, that is the phase's central failure — diagnose and fix it; do not narrow A3
to a smaller demo. A working full loop with an Uno blink and a BOM is the bar, and it must be
headless.

If auth cannot be made correct in this phase, ship stdio only, bind HTTP to loopback with no
production mode enabled, and record HTTP transport under `GAPS`. **A loopback-only HTTP server is
acceptable; a half-secured public one is not.**

---

## 10. Final report

`docs/phase-reports/v08_mcp_server.md`: `BASELINE`, `TOOL_SURFACE` (count by group, and the full
name mapping table), `A3_TRANSCRIPT` (the actual reference-client transcript of the end-to-end
build — paste it verbatim, it is the proof), `SECURITY`, `ACCEPTANCE` table, `EXISTING_TESTS`,
`ESCALATION`, `GAPS`, `DEVIATIONS`.