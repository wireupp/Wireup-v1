# WireUp MCP agent guide

WireUp's local MCP server exposes the existing electronics project API over stdio. Start
the FastAPI and web development servers with `npm run dev`, then connect an MCP client to
`services/mcp/server.mjs`. In VS Code, the checked-in `.vscode/mcp.json` provides this
stdio configuration.

## First steps

1. Read `wireup://capability` and this guide, or call `capability_read` after creating a session.
   A bound session receives a per-project node-by-node resolution; use `capability_explain` for a
   kind's solver manifest, remaining limitations, and unpassed test ids.
2. Call `session_create`. To continue an existing project, pass its `project_id`; otherwise
   call `project_create` next.
3. Call `project_read` or `read_project` before changing a project. Record its `revision`.
   To read it as an MCP resource, use
   `wireup://project/{project_id}?session_id={session_id}`; unscoped project resources are rejected.
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

- Read `wireup://capability` or call `capability_read` first. A generated status means the
  declaration was produced from solver registrations; `partial` confidence is not a verified
  acceptance result.
- A project-bound `capability_read` resolves each project's nodes against the generated kind
  records and identifies placement-only blockers. `capability_explain` returns the registered
  solver manifest and its exact known failures and requirements.
- Project resources require the session id that is bound to that project, so a resource URI
  cannot be used to read a project outside the current session's scope.
- `run_simulation` invokes the existing browser runtime. A connected browser must be open and
  acknowledge the run; the MCP server does not simulate headlessly.
- Headless runtime execution, vehicle mechanics, environmental simulation, software sandboxing,
  and a website-to-device bridge remain unavailable. The registered legacy solver manifests do
  not replace the current browser runtime or the legacy hardware mutation path.
- A successful compile is not a successful simulation. Report only evidence returned by the
  tools.
- Unavailable or unverified hardware remains unavailable; do not approximate or infer a pass.

## Reviews and revisions

Tools marked `requires_review` demand `review_approved:true`. Only provide it after explicit
human approval. The local MCP bridge treats this as a caller assertion; it cannot independently
verify which human approved it. MCP clients/deployments must enforce human confirmation before
forwarding the flag. Do not treat the flag alone as proof that an approval workflow ran. A stale
revision means re-read the project and retry with the current revision.

`project_delete` additionally requires `confirm:true`. MCP sessions are in-memory, expire after
60 minutes by default, and are capped at eight hours. `session_id` is required on every tool
call except `session_create`.

## Errors

An `isError:true` result is a real failure. A `REVISION_STALE` result tells you to re-read the
project and retry with its current revision. `SESSION_EXPIRED` means the session is gone; create
a new session and explicitly bind it to the intended project. `RATE_LIMITED` is retryable after
the limit window. For other errors, inspect the current project and contract and correct the cause.
Retry only retryable operations after re-reading state.
The MCP process writes audit metadata to stderr using a hash of arguments; it does not write
raw source, runtime tokens, or credentials to the audit record.

## Local-only security

The stdio server permits only a loopback `WIREUP_API_URL` (default
`http://127.0.0.1:8000`). It may use `WIREUP_ACCESS_TOKEN` to authenticate to a protected local
API. Runtime tokens are kept in the MCP process and are not returned in project/resource
results. No network listener is started by stdio.
