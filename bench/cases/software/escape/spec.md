# software/escape

**Human intent.** The v12 brief calls this case mandatory: *"All must fail cleanly, be recorded
as a sandbox violation, and leave the supervisor alive. A single escape is a critical defect."*

## The corpus, and the honest answer to each entry

| Attack | Where it would land | What actually happens | Why |
|---|---|---|---|
| read `process.env` | a script process | **nothing executes** | there is no script process |
| read `~/.aws/credentials` | a script process | **nothing executes** | same |
| write outside the scratch dir | a script process | **nothing executes** | same |
| fork bomb | a script process | **nothing executes** | same |
| open a raw socket | a script process | **nothing executes** | same |
| `eval` in a web app | a script engine | **there is no script engine** | the supervisor serves bytes |
| prototype pollution via a probe | the expression evaluator | rejected, `INVALID_PROBE` | probe targets are plain data; getters are never invoked |
| prototype pollution via an expression | the expression evaluator | rejected, `INVALID_EXPRESSION` | `__proto__` and `prototype` are forbidden identifiers |
| infinite loop | an expression or a script | **cannot be written** | the language is a bounded recursive-descent parser with no loop construct |
| environment leak into a page | the HTTP server | asserted impossible | the served body is byte-identical to the declared file |

`bench/cases/software/limit/A2` additionally asserts that **no environment variable value**
appears in the served page, by scanning every process environment variable long enough to matter.

## Why "nothing executes" is a control and not an evasion

The usual failure mode of a sandbox is claiming an in-process restriction is a security boundary.
v07 established that this platform has no OS-enforced network boundary available: Node's
`--permission` flag did not deny a loopback fetch on `v22.13.0`, and WSL `unshare --net` returned
`Operation not permitted`. Rather than ship a weaker parallel story, v12 **ships less capability**:
the sandbox serves bytes and the probe evaluator has no I/O. Every capability that would need a
real boundary — script execution, client-side JS, dependency installation, native compilation,
screenshots, the device bridge, persistence — is declared unavailable with the concrete thing
that would be required.

## The supervisor survives

Every assertion here runs in the same process that hosts the supervisor, and `software/limit` runs
a further bound-violation corpus afterwards. If a violation took the process down, the bench run
would fail rather than quietly shrink.

## When this case must change

If a later phase adds a headless renderer, a script lane, or a dependency installer, **this file
must be extended before that phase claims to be safe**, and the phase report must state RED until
it is. A new execution surface means a new escape corpus, not a rerun of this one.