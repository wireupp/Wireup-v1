# software/script

**Human intent.** *Some code the agent wrote, that computes something.* Delivered at the only
level this platform can defend.

**What a `software.script` is here.** A declared list of probes evaluated by
`packages/core/trials/probes.mjs`: a bounded, total expression language over measured values,
with no I/O of any kind — no filesystem, no network, no process, no `eval`, not Turing complete.
The two declared programs are `value * 2` over a measured element count, and a range check.

**What it is not.** Python. Node. A general-purpose interpreter. Phase v07 established that this
platform has no OS-enforced network boundary for worker processes — Node's `--permission` flag
does not deny sockets (a loopback fetch succeeded on `v22.13.0`) and WSL `unshare --net` returns
`Operation not permitted`. Running agent-authored code in a process that can open a socket would
be claiming a security boundary that does not exist, so the solver refuses it and
`manifest.unavailable` says exactly what would be needed.

**Acceptance.**

| Assertion | Threshold |
|---|---|
| The program runs | both declared assertions pass, quality `measured` |
| No side effects | the run publishes exactly the five expected channels and nothing else |
| Declared honestly | the `software.script` kind carries an unavailable entry naming the missing network boundary |

**A2 is the assertion that would catch a regression into something more dangerous.** If the
evaluator ever grew a way to read a file, open a socket or call out to the host, this channel
list would change. It is pinned deliberately.