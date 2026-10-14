# WireUp MCP agent guide

WireUp's local MCP server exposes the existing electronics project API over stdio. Start
the FastAPI and web development servers with `npm run dev`, then connect an MCP client to
`services/mcp/server.mjs`. In VS Code, the checked-in `.vscode/mcp.json` provides this
stdio configuration.

## First steps

1. Read `wireup://capability` and this guide.
2. Call `session_create`. To continue an existing project, pass its `project_id`; otherwise
   call `project_create` next.
3. Call `project_read` or `read_project` before changing a project. Record its `revision`.
4. Search the catalog with `search_components` before placing a component.
5. Use the appropriate wire/component tools, passing the current `expected_revision`.
6. Read the project again after each mutation; use its new revision for the next mutation.
7. Use `compile_firmware` to compile firmware and inspect compiler errors when it fails.
8. Use `validate_circuit` and `check_connections` for their explicitly limited topology checks.

## Supported work

The exposed mutation and read tools delegate to the existing local hardware command route.
They can create projects, search/modify components, connect wires, edit and compile firmware,
run the existing circuit checks, and read project/compiler/runtime results. Tool descriptions
are composed from `contracts/tools/`; MCP names replace dots in contract names with underscores.

## Honest capability boundaries

- Read `wireup://capability` first. Its generator status is authoritative and may still say
  `stub`.
- `run_simulation` invokes the existing browser runtime. A connected browser must be open and
  acknowledge the run; the MCP server does not simulate headlessly.
- Telemetry recording, trial execution, mechanics solvers, software solvers, and the unified
  graph tool bus are not implemented by this local MCP bridge.
- A successful compile is not a successful simulation. Report only evidence returned by the
  tools.
- Unavailable or unverified hardware remains unavailable; do not approximate or infer a pass.

## Reviews and revisions

Tools marked `requires_review` demand `review_approved:true`. Only provide it after explicit
human approval. The server does not manufacture an approval or bypass the backend's revision
check. A stale revision means re-read the project and retry with the current revision.

`project_delete` additionally requires `confirm:true`. MCP sessions are in-memory, expire after
60 minutes by default, and are capped at eight hours. `session_id` is required on every tool
call except `session_create`.

## Errors

An `isError:true` result is a real failure. Read its code/message, inspect the current project
and contract, and correct the cause. Retry only retryable operations after re-reading state.
The MCP process writes audit metadata to stderr using a hash of arguments; it does not write
raw source, runtime tokens, or credentials to the audit record.

## Local-only security

The stdio server permits only a loopback `WIREUP_API_URL` (default
`http://127.0.0.1:8000`). It may use `WIREUP_ACCESS_TOKEN` to authenticate to a protected local
API. Runtime tokens are kept in the MCP process and are not returned in project/resource
results. No network listener is started by stdio.
