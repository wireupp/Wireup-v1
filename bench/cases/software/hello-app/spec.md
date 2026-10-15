# software/hello-app

**Human intent.** *"Make me a website."* The smallest honest version of that: an agent declares
some files, the platform serves them, and something **checks** the result rather than declaring
it fine.

**Acceptance.**

| Assertion | Threshold |
|---|---|
| Serve and probe | HTTP 200 and every declared DOM probe passes |
| Measurement honesty | status and byte length reported as `measured` |
| CSP | `default-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `script-src 'self'` |
| Containment | encoded traversal → 403, plain traversal never 200, `PUT` → 405 |
| Preview parity | digest of the served files is stable and key-order independent |
| Declared limits | client-side JS, script execution, dependency installation and screenshots are all named as unavailable |

## What this solver does NOT do, and why that is the interesting part

**No code execution.** The supervisor serves bytes. There is no script engine in the process at
all — not "a restricted one", not "a sandboxed one". Probes read the served markup *as data*
through a set of named operations (`exists`, `count`, `text`, `html`, `attr`, `value`,
`has_class`, `title`). A page that only reveals its content after running JavaScript is therefore
**not observable**, and the solver says so in `manifest.unavailable` rather than pretending.

**No agent-authored Python or Node.** Phase v07 established that this platform has no OS-enforced
network boundary for worker processes: Node's `--permission` flag does not deny sockets (a
loopback fetch succeeded) and WSL `unshare --net` returns `Operation not permitted`. Shipping a
script sandbox without one would be claiming a security boundary that does not exist, so
`software.script` is restricted to a declared telemetry program evaluated by the same bounded,
side-effect-free expression evaluator the trial probes use — no I/O, no filesystem, no network,
not Turing complete.

**What IS protected, and how:**

1. No evaluation of any kind (the load-bearing control).
2. Loopback on an ephemeral port — not reachable off-host, no collisions between parallel runs.
3. Path containment with real-path resolution; only declared files are reachable.
4. `GET`/`HEAD` only.
5. CSP by **header**, including `connect-src 'none'`.
6. Static scan: inline event handlers, `javascript:` URLs, remote `<script src>` and `<iframe>`
   are refused *before* anything is served, and recorded as violations.
7. Per-run caps on document bytes, request count and wall clock.

`docs/SANDBOX.md` carries the full threat model, including the mandatory "what is not covered"
section.

## Probe teeth

A probe that cannot fail is decoration, so a **failed** probe is published as
`script.probe_ok = 0` with its error code rather than dropped from the stream.
`software/dom-assert` is the case that proves a wrong app fails.