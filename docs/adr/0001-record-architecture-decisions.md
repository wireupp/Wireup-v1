# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-10-14

## Context

Phase v01 removed thirteen status and audit reports from this repository because they had grown
contradictory, were individually outdated, and were cited indiscriminately by every automated
agent reading the tree. The information was not worthless — the *shape* was. There was no
mechanism to distinguish "a decision we made" from "a status someone observed on one afternoon".

The result was that knowing the system's actual decisions required reading diffs.

## Decision

Decisions that constrain the system are recorded as architecture decision records in
`docs/adr/`, in the format in `docs/adr/README.md`. Records are immutable. Reversal is a new
record, not an edit.

Status reports are not decisions and do not belong here. They belong in `docs/phase-reports/`,
which records what a specific phase did, with real command output, and is dated by its phase.

`docs/ARCHITECTURE.md` is the parent document and describes the current system. It summarises and
links to ADRs; it does not replace them.

## Consequences

Easier: a new agent reads `ARCHITECTURE.md` plus the ADR index and knows why the system is shaped
this way. A decision cannot be quietly reversed without leaving a trace.

Harder: writing an ADR costs a file. This is deliberate friction — a decision that is not worth a
paragraph is probably not a decision.

Forbidden: editing an accepted ADR; using a phase report as a decision record; adding a new
top-level status report outside `docs/phase-reports/`.

## Alternatives considered

- **Keep the audit reports, add dates.** Rejected: they had already drifted; dating them does not
  resolve which one an agent should believe.
- **A single living status document.** Rejected for decisions, kept for status — that is
  `RELEASE_STATUS.md`, deliberately capped at 30 lines.
- **No records, rely on git history.** Rejected: git tells you what changed, not what was decided
  or what was deliberately rejected.