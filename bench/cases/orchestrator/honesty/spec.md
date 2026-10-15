# orchestrator/honesty

**Human intent.** Point the platform at a goal, walk away, and get back something you can build.
The hard half of that sentence is the second half: a report that says *no* has to be as useful as
one that says *yes*, and it must cost nothing.

## The loop

```
goal.parsed → plan.created | plan.rejected
  → for iteration in 1..max_iterations:
       budget check (stop before starting, not after)
       mutate through the tool bus           (invariant I1 — there is no other path)
       optional model call in the firmware seat (counted, bounded)
       headless trial                        (no browser, no chat client)
       verdict                               (measured number + trial id, or NOT_MEASURED)
       pass → stop · error → classify · unclassified → stop and report
  → report.ready
```

The plan is **replayed against the graph rules before a single node is added**. That replay is not
ceremony: during development it caught two real defects (a forbidden `project_id` graph property,
and node ids that did not match the `<kind-prefix>_<8 hex>` convention) that would otherwise have
produced a project the store rejected mid-run.

## Determinism, and where the model sits

Kind selection, step ordering and the parameter search are deterministic. A configured provider is
given the firmware seat and is counted against `max_model_calls`; with no provider configured the
run spends zero calls and the report says so. A provider that throws stops the run (H4) — the
alternative, continuing on a half-built project and calling it success, is the exact failure this
phase exists to prevent.

## The honesty tests

| Test | What it pins down |
|---|---|
| **H1** | `build a solar-powered boat` → infeasible, **zero mutations**, no BOM, no total, `requiredToSupport` naming the missing irradiance model |
| **H1b** | `a submarine drone rated to 300 m depth` → still refused after v11 made mechanics real. Honesty must survive a capability increase |
| **H1c** | an app calling a corporate API at `10.0.0.5` → refused with an egress-policy requirement |
| **H2** | `holds 9 m/s` → hits the iteration bound, reports `unverified`, populates `unmet`, does not spin |
| **H4** | provider failure → run stops, `blocked` event, the reason is in the deliverable |
| **H5** | placement-only parts carry no price and no behavioural claim |
| **H6** | budget exhaustion is reported as exhaustion, never as `verified` |
| **H7** | a run stopped at iteration 1 leaves a revision-consistent graph, and an identical later run measures the same value |
| **A3/A4/A5/A6/A8** | `unmet` non-empty below `verified`; every verification row cites a trial; no untraceable price; the model budget is enforced from a counter; the run needs no browser and no chat client |
| **A7/A9** | a software goal verifies headlessly with a measured load time; an electronics goal is refused with the headless runtime worker named |

## Budget semantics

`check()` answers *"should the loop stop before starting another unit?"* and treats
`used >= limit` as exhausted. `assert()` answers *"may this unit be spent?"* and only trips on
`used > limit`. Conflating them makes `max_iterations: 1` mean zero iterations — an off-by-one in
the direction that makes the bound a lie.

`max_spend_usd` defaults to `0`, which means *spend nothing*, not *you have already spent your
whole zero budget*: a limit of zero only bites once something is actually spent.

## The one deviation from the brief, stated plainly

The brief's acceptance A1 requires `bench/cases/orchestrator/unolen` to reach `verified` with a
1 Hz measurement. **That is not achievable on this platform and the case is not shipped as if it
were.** Compiling and running Uno firmware headlessly requires the runtime worker that phase v07
refused to build, because no OS-enforced network boundary is available here (Node's `--permission`
does not deny sockets; WSL `unshare --net` is not permitted). The honest form of that test is A9:
an electronics goal is **refused**, with the missing capability named. The positive lane the brief
asks for exists instead for boats (`A7` for software, and the boat goal itself) — those are the
domains this platform can actually verify today.