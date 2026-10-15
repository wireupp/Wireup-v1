# software/dom-assert

**Human intent.** Probes have teeth.

**Setup.** The same declared probes from `software/hello-app` are run against a deliberately
wrong app: the status paragraph says `warming up`, the `<title>` and the `<h1>` both say
`(draft)`. The probes still expect `ready`, `WireUp Bench`, two telemetry rows and a `status`
attribute.

**Acceptance.**

| Assertion | Threshold |
|---|---|
| Wrong app | at least two probes fail |
| Failure visibility | each failure is published with `EXPECTATION_FAILED`, not dropped |
| Stream shape | the probe stream has the same length for the wrong and the right app |
| Right app | the identical probes pass |
| Served anyway | HTTP 200 — this is a content failure, not a sandbox refusal |

**Why the stream-shape assertion exists.** A probe implementation that silently skips
assertions it cannot evaluate would produce a shorter stream when the app is wrong, and a
reviewer reading only the pass/fail count would never notice. Comparing lengths across the two
apps makes "the probe disappeared" a distinguishable outcome from "the probe failed".

**Why A5 matters.** If a wrong app produced a 403, this case would pass for the wrong reason —
the sandbox would be doing the checking instead of the probes. The app must be served cleanly and
then judged on its content.