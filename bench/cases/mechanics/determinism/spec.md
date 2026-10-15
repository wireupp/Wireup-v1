# mechanics/determinism

**Human intent.** Invariant I9: the same graph and the same seed must produce the same result.
A physics engine that is "usually" reproducible is not reproducible, and a trial that cannot be
replayed cannot be evidence.

**Acceptance.** Ten runs of a graph containing a seeded wave model, wind, a thruster and a
barometer produce one NDJSON digest.

**How the digest is computed.** `packages/core/telemetry/recorder.mjs` writes
`canonicalStringify(sample) + "\n"` for every sample with gzip `mtime: 0`. Hashing the
concatenation of those lines therefore reproduces the uncompressed recording byte for byte.
Byte-identical gzip framing itself is asserted separately by `meta/telemetry` A4.

**What "deterministic" costs, and why the graph is not trivial.** Fixed timestep, node-order
iteration, no `Math.random`, no wall clock, no hash-iteration-order dependence, and a seeded
wave model whose phase comes from simulation time rather than a random draw. This is the
reason the integrator is semi-implicit Euler at a FIXED step rather than an adaptive one: an
adaptive stepper makes the trajectory depend on floating-point accumulation order, which would
silently break this assertion while still looking stable on screen.

**A3 is deliberately weak, and says so.** The declared wave model is seeded by construction,
so a different seed can legitimately produce the same trajectory. A3 records that the seed is
an explicit, required input to `prepare()` — the solver refuses a non-integer seed — rather
than pretending every seed yields a different answer.