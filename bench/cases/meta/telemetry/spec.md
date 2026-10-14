# Telemetry and trial acceptance

This case checks the v05 telemetry and trial foundations using deterministic fake solver
services. It exercises metrics, insufficient-data verdicts, quality enforcement, recording
integrity, bounded-memory accounting, sweep ordering and failure isolation, cancellation,
expression sandbox rejection, and token exclusion.

Run `node bench/cases/meta/telemetry/check.mjs` from the repository root. This checker is
registered as the authoritative v05 bench assertion; it is intentionally not executed as part of
the current code-only continuation.
