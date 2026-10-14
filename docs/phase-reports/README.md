# Phase reports

One report per phase, written by the agent that executed it, in build order. **Read these instead
of diffs.** They are the honest record of what was actually verified.

Files are named `vNN_<phase_slug>.md`, matching `prompts/vNN_<PHASE>.md`.

## Required sections, in this order

Every report contains exactly these, in this order. Nothing else.

### 1. `BASELINE`
The verification results from **before** any change, with real output. If a suite was not run,
say `NOT RUN`. A report without a baseline cannot prove it preserved anything.

### 2. `CHANGES`
Files created, deleted, modified — one line each. No prose.

### 3. `ACCEPTANCE`
A table: assertion id, command, real result, PASS/FAIL. Every assertion the phase brief named.
Paste the actual output; a summary is not evidence.

### 4. `EXISTING_TESTS`
Before/after counts for every suite. **No new failures.** A suite that could not be run says so
explicitly.

### 5. `ESCALATION`
One of:

- **GREEN** — assertions pass; no contract, dependency or security surface changed.
- **AMBER** — assertions pass, but a node kind, tool or contract field was added. One paragraph on
  what a reviewer should look at.
- **RED** — an assertion failed, a contract broke compatibly, or auth / sandboxing / licensing /
  spend is involved. One specific question for the human.

A phase never self-promotes RED to AMBER.

### 6. `GAPS`
Things this brief did not cover that the agent noticed. **Listing is the deliverable; acting on a
gap is not.** Gaps belong to a later phase.

### 7. `DEVIATIONS`
Anything done differently from the brief, with a reason. Empty is a good answer. A documented
deviation is reviewable; a silent one is a failed phase.

## Rules

- Paste real command output. Never describe output you did not see.
- `NOT RUN` is an acceptable entry. A fabricated pass is not.
- Never disable a test, lower a tolerance, or delete an assertion to make a phase green.
- An empty `GAPS` section on a large phase is a warning sign, not a good sign.

## Index

| Phase | Report | Status |
|---|---|---|
| v01 | `v01_repo_ground_rules.md` | complete |