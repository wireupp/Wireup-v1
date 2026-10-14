# v04 — TOOL BUS

**Goal:** create `packages/toolbus` — one typed mutation path that the UI, the in-app agent and
(after `v08`) MCP all call. Then rewire the existing backend onto it without changing a single
user-visible behaviour.

---

## 0. Hard rules

`prompts/v00_MASTER_PLAN.md` §0 and §3 apply. Contract truth is `contracts/tools/*.tool.json`
(`v02`). This is a **refactor with zero behaviour change** — if a user could tell the difference,
you have failed.

---

## 1. Context

The single most valuable seam in the current codebase is
`backend/hardware/commands.py::command(project_id, name, args, runtime_token)`: one dispatcher,
one validation gate, one mutation path. It is already close to a tool bus. It is not:

- described by a contract,
- callable in-process without HTTP,
- usable by the UI without a round trip,
- uniform in its result shape (some branches return a project, some return
  `{"status":"acknowledged",...}`, some raise `HTTPException`).

The tool bus fixes those four things and changes nothing else.

---

## 2. Preconditions — verify, do not assume

1. `contracts/tools/*.tool.json` exists and covers every legacy tool (assert `v02` A2 passed).
2. `packages/core/graph` exists with `adapters/electronics.ts` and `legacyDiff`.
3. Read `backend/hardware/commands.py` in full. Record, in your report, the exact list of
   behaviours that must be preserved: revision checks, the 200 KB argument cap, the
   `allow_nan=False` JSON check, the `429` on too many pending runtime commands, the `503`
   compiler-busy path, artifact retention of the last 10, staleness detection, and the
   `authorize_runtime` token check.
4. Read `backend/security.py` `local_connection` and the `dependencies=[Depends(local_only)]` on
   both routers. The bus must be callable from a server process without weakening this.
5. Record the full result shape of every legacy tool by calling it against a test project and
   saving the JSON into `bench/cases/meta/tool-bus/baseline/<tool>.json`. **This is your
   regression oracle.** Do it before writing any code.

---

## 3. What to build — `packages/toolbus/`

### 3.1 `types.ts`

```ts
export type ToolContext = {
  projectId: string;
  actor: { kind: "user" | "agent" | "system"; id: string; sessionId?: string };
  runtimeToken?: string;        // never logged, never returned
  expectedRevision?: number;
  review?: { approvalId: string; scope: { tools: string[]; kinds: string[]; quantities: Record<string, number> } };
  deadlineMs: number;
  signal?: AbortSignal;
  store: GraphStore;
  services: ToolServices;      // injected capabilities, see §3.2
  emit(event: ToolEvent): void;
};

export type ToolResult =
  | { ok: true;  data: unknown; revision: number; artifacts?: ArtifactRef[]; warnings?: ValidationIssue[] }
  | { ok: false; error: ToolError };

export type ToolError = {
  code: string;                 // from the contract's errors[]
  message: string;              // human-readable, names the offender
  details?: unknown;            // structured, safe to show an agent
  retryable: boolean;
};
```

**No tool ever throws across the bus.** Exceptions are caught at the boundary and mapped to
`ToolError` using the contract's error codes. An agent must never receive a Python traceback or a
Node stack.

### 3.2 `services.ts` — dependency injection

The bus holds no I/O. Everything external is injected:

```ts
export interface ToolServices {
  catalog: { search(query, limit, group?): CatalogEntry[]; readKind(id): KindDef };
  compiler: { compile(input: CompileInput): Promise<CompileResult> };
  runtime:   { run(req): Promise<RunHandle>; stop(h): Promise<void>;
               results(h): Promise<RuntimeResults>; probe(h, probe): Promise<ProbeResult> };
  telemetry: TelemetryBus;                    // v05; stub interface here
  trials:    TrialService;                    // v05; stub interface here
  solvers:   SolverRegistry;                  // v06; stub interface here
  persistence: GraphPersistence;
  clock:     { now(): number };                // injectable for determinism
  rng:       (seed: number) => Rng;           // injectable
}
```

Provide `createStubServices()` for tests. Every stub **must** fail loudly if called before its
phase exists — throw `ToolError{code:"NOT_IMPLEMENTED"}` with a message naming the phase that owns
it. Silent stubs are forbidden.

### 3.3 `registry.ts`

Builds the tool table from `contracts/tools/*.tool.json`:

```ts
registry.get(name): ToolDefinition | undefined
registry.list({ domain?, mutating?, requiresRuntime? }): ToolDefinition[]
registry.validateArgs(name, args): ValidationIssue[]
```

Tool definitions are `{ contract, handler }`. The registry refuses to start if any contract lacks a
handler or any handler lacks a contract. `contracts/capability.json`'s `"generator_status":"stub"`
does not block this — the registry only needs `contracts/tools/`.

### 3.4 `tools/` — handlers

One file per tool group. Write handlers for **every** contract in `contracts/tools/`. Legacy tools
(`legacy_names` present) get a handler that delegates to `legacyDiff` from `v03` plus the existing
Python service for anything the graph cannot yet express (compile, runtime, remote ESP, flash).

Group them:

- `tools/project.ts` — `project.create/read/delete/export`
- `tools/node.ts` — `node.add/remove/modify`
- `tools/edge.ts` — `edge.connect/remove`
- `tools/catalog.ts` — `catalog.search/read_kind`
- `tools/firmware.ts` — `firmware.read/write/edit/compile`
- `tools/runtime.ts` — `runtime.run/stop/probe/results`
- `tools/telemetry.ts` — `telemetry.read`
- `tools/trial.ts` — `trial.run/sweep/read`
- `tools/bom.ts` — `bom.build/read`, `assembly.read`
- `tools/platform.ts` — `capability.read`, `room.list`, `room.enter`, `session.create`,
  `calculator.evaluate`

Contract-handling rules, all enforced by a generic wrapper so no handler can forget:

1. Validate args against the contract **before** the handler runs.
2. Check `expected_revision` (invariant I2).
3. If `requires_review`, require a valid `review` in context whose scope covers this tool, this node
   kind and this quantity. Reuse the existing approval semantics from
   `backend/feasibility.py` — do not weaken them.
4. Run the handler.
5. Validate the result against the contract's `result` schema.
6. Emit `ToolEvent`s (`tool.started`, `tool.progress`, `tool.finished`) for the activity feed.
7. Strip runtime tokens from every emitted event, result and error (invariant I8). Enforce with a
   recursive scrubber plus a test that plants a token in a handler result and asserts it is gone.

### 3.5 `bus.ts`

```ts
class ToolBus {
  invoke(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult>
  invokeBatch([{name,args}], ctx): Promise<ToolResult[]>   // sequential, atomic per item
}
```

Rules:
- Sequential within a batch. Parallel mutation is forbidden (I3).
- A batch is **not** a transaction: each item is its own atomic apply. If item 3 fails, items 1–2
  stand and the result says so explicitly per item. `wire_circuit` remains the tool for genuine
  multi-edge atomicity.
- Deadline enforcement: `ctx.deadlineMs` aborts between items, never mid-apply.
- Per-session rate limit mirroring the existing `429` behaviour.

### 3.6 `agent/` — LangGraph interop

Expose the bus to the existing Python LangGraph agent without rewriting the agent:

- `backend/services/toolbus_client.py` — a Python client that speaks the bus over local HTTP
  (in-process where possible), with the same `ToolResult` shape.
- A generic `call_tool(name, args)` LangChain tool bound in `backend/agent/graph.py` **in
  addition to** the existing 20 explicit tools. Set `MAX_TOOL_CALLS` behaviour unchanged.
- The existing explicit tools delegate to the bus internally, so both paths share one
  implementation. Delete the duplicated logic in `backend/agent/schemas.py` handlers **only after**
  the baselines from §2.5 match.

### 3.7 Backend rewire

- `backend/hardware/api.py` keeps its routes and its `Depends(local_only)` guard. The
  `POST /project/{id}/command` route becomes a thin adapter: validate against the contract, build a
  `ToolContext` from the request, invoke the bus, map `ToolResult` back to the legacy HTTP shape
  (200/4xx/503 exactly as today).
- Add `GET /api/capability` returning `contracts/capability.json`.
- Add `POST /api/telemetry/query` and `POST /api/trial/run` — thin adapters over the bus.

**The baselines from §2.5 are the acceptance test.** Byte-compare every legacy response.

---

## 4. Files

**Create:** `packages/toolbus/**`, `backend/services/toolbus_client.py`,
`bench/cases/meta/tool-bus/**` (baselines + assertions).

**Modify:** `backend/hardware/api.py`, `backend/hardware/commands.py` (delegate, do not delete
behaviour), `backend/agent/graph.py` (bind the generic tool), `backend/app.py` (mount new routes),
`package.json`, `docs/ARCHITECTURE.md`.

**Do not touch:** `src/**` (the UI keeps calling the old HTTP route unchanged — `v13` reroutes it),
`vendor/**`, `contracts/**`.

---

## 5. APPROVED DEPS

None. The bus is dependency-free TypeScript plus `ajv` from `v02`.

---

## 6. Acceptance criteria

- **A1** **Parity:** for every tool in `bench/cases/meta/tool-bus/baseline/`, invoking through the
  bus on the same starting project produces a response that deep-equals the baseline after
  normalising volatile fields (`updated_at`, `compiled_at`, artifact ids, hashes). Every such tool
  is a case; the assertion reports the count.
- **A2** All existing pytest and Playwright suites unchanged (exact counts).
- **A3** The token-scrubber test: a handler returning a runtime token anywhere in a nested
  structure yields a result with no trace of it. Also test error messages and `ToolEvent`s.
- **A4** `registry` fails to initialise when a contract lacks a handler — proven by a test that
  removes one.
- **A5** `stubServices` throw `NOT_IMPLEMENTED` naming the owning phase for `telemetry.*`,
  `trial.*`, `runtime.probe`, `solver.*` — proven by a test that calls each.
- **A6** Review enforcement: a `requires_review` tool called without a matching `review` in context
  returns `REVIEW_REQUIRED` and changes nothing; called with one, it succeeds.
- **A7** `expected_revision` mismatch on every mutating tool returns `REVISION_STALE` and leaves the
  graph byte-identical. Loop across all mutating tools from the registry.
- **A8** Concurrency: 20 parallel `node.add` calls on one project produce exactly 20 changes with
  no lost update and a final revision of +20 (or a documented, correct `REVISION_STALE` for the
  losers — whichever the design yields, assert that one, not both).
- **A9** No tool throws: a test iterates every tool with deliberately invalid args and asserts a
  `ToolResult` with a contract-listed error code, never an exception.

---

## 7. Verification

```powershell
npm run build
npm run lint
npm run core:test
node scripts/python.mjs -m pytest backend/tests -q
npm test -- --workers=1
node bench/run.mjs
```

Plus: manually diff each baseline response against its bus result and paste the table.

---

## 8. Out of scope

- MCP. `v08`.
- Telemetry, trials, real solvers. `v05`, `v06`. Stubs only.
- Rerouting the UI. `v13`.
- Removing the legacy Python implementation entirely — that happens only after `v13` proves the
  UI is on the bus, and is not part of this phase.

---

## 9. If you are blocked

Parity (A1) is the whole point of this phase. If a legacy response cannot be reproduced
byte-for-byte after honest effort, do **not** loosen the comparison to make it pass. Record the
mismatching fields in `DEVIATIONS` with the exact old and new values, mark the phase AMBER, and
continue with everything else. A documented behaviour change is reviewable; a hidden one is not.

If the LangGraph interop (§3.6) turns out to require restructuring the agent's tool scoping — which
is plausible, because the existing agent has hand-tuned scoping logic in `backend/agent/graph.py` —
then **skip §3.6 entirely** and record it under `GAPS`. The bus is valuable on its own; do not
damage a working agent to prove a point. The Python client (`backend/services/toolbus_client.py`)
is still required, because `v08` needs it.

---

## 10. Final report

`docs/phase-reports/v04_tool_bus.md`: `BASELINE`, `LEGACY_BEHAVIOURS` (the §2 list, each marked
preserved/changed), `PARITY_TABLE` (tool → baseline vs actual → match),
`ACCEPTANCE` table, `EXISTING_TESTS`, `ESCALATION`, `GAPS`, `DEVIATIONS`.