# ADR-0002: Contracts before code

- Status: Accepted
- Date: 2026-10-14

## Context

The shape of a WireUp project is currently defined in three places that disagree: the TypeScript
types the UI imports, the Python Pydantic models the backend validates with, and the agent tool
schemas the model reads. They drift, and every drift is a class of bug where the UI shows
something the agent cannot build or the agent claims something the UI cannot render.

More broadly: an agent working this repository currently has to read source code to learn an API
shape. Reading source to learn a shape is unreliable and expensive, and it is why agents produce
plausible-but-wrong calls.

## Decision

Machine-readable schemas in `contracts/` are the single source of truth for every wire shape:
graph, ports, kinds, telemetry, trials, capability, and one file per tool.

Rules:

1. A shape that crosses a process boundary is declared in `contracts/` before it is implemented.
2. Code conforms to the contract. When code and contract disagree, the contract is corrected to
   match reality, or the code is fixed — decided explicitly, never silently.
3. Contracts are versioned, hashed in `contracts/manifest.json`, and verified in CI.
4. Agents read contracts. They do not read source to discover shapes.
5. A tool's description, arguments, result and failure modes are declared in
   `contracts/tools/*.tool.json`. The MCP surface in phase v08 is generated from these files, so
   documentation drift becomes a build failure rather than a support issue.

## Consequences

Easier: agents become reliable, because the contract *is* the prompt. Adding a tool becomes a
declaration plus a handler. Documentation cannot drift from behaviour.

Harder: two places to change when a shape evolves — the contract and the implementation. That is
the intended cost, and it is caught by `npm run contracts:check`.

Harder: contract changes are AMBER escalations, because a changed shape affects every consumer.

Forbidden: defining a shape in TypeScript types and treating that as authoritative; adding a tool
whose contract is written afterwards; letting a tool description live only in a prompt.

## Alternatives considered

- **Generate TypeScript and Python from a single source.** Rejected for now: adds a build step and
  a generator before the shape of the platform is settled. JSON Schema with a validation library
  achieves the guarantee without codegen.
- **Document APIs in prose.** Rejected: prose is not checkable and cannot be enforced in CI.
- **Leave as-is with three definitions.** Rejected: this is the problem.