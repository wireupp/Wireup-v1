# Architecture decision records

One file per decision: `NNNN-short-title.md`. Records are immutable once accepted. If a decision
is reversed, write a new record that supersedes it and mark the old one `Superseded by ADR-NNNN`.
Do not rewrite history.

## Format

```markdown
# ADR-NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR-NNNN
- Date: YYYY-MM-DD

## Context
What forced a decision. Facts only.

## Decision
What was decided, in the present tense.

## Consequences
What becomes easier, what becomes harder, what is now forbidden.

## Alternatives considered
Each with the reason it was not chosen.
```

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-contracts-before-code.md) | Contracts before code | Accepted |