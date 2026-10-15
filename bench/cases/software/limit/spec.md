# software/limit

**Human intent.** A limit that is not reported is indistinguishable from a hang.

**Why three of the brief's four limits are expressed differently here.** The brief's corpus was
*infinite loop, a 1 GB allocation attempt, and a 10 MB output attempt*. In a design that never
evaluates agent content and never spawns a process for it:

- **Infinite loop** — cannot be written. The probe language is a bounded recursive-descent parser
  over a finite token stream with no loop construct and no recursion. The nearest real failure is
  a probe whose data source never resolves, which is asserted (A3) and bounded by `timeout_ms`.
- **1 GB allocation** — there is no allocator an agent can drive. The analogous bound is a
  document too large to serve, asserted (A1) with `SANDBOX_LIMIT_EXCEEDED`.
- **10 MB output** — asserted as the per-file and per-document byte caps (A1) and the
  request-count cap (A2).

Rewriting the corpus to match the design is a `DEVIATION`, recorded in the phase report. What is
not a deviation: every limit that can be hit reports a named code.

**Acceptance.**

| Assertion | Threshold |
|---|---|
| Over-sized file | refused, `SANDBOX_LIMIT_EXCEEDED`, message names the per-file cap |
| Request cap | exactly N served, then `429` with zero bytes and a recorded code |
| Timeout | `PROBE_TIMEOUT` well inside the declared bound |
| Program size | `EXPRESSION_TOO_LARGE` / `INVALID_EXPRESSION` / no loop construct |
| CSP | `default-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'` |
| Wall clock | a 1 ms budget still yields a governed response carrying the CSP header |

**A6 is deliberately weak and says so.** It asserts the response is *governed* (200 or 429, CSP
present), not that a specific status is produced, because a 1 ms budget can legitimately be met.
The assertion that matters is that the response is never ungoverned.