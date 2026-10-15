# environment/recorded-weather

**Human intent.** *"A drone project reading real weather data from an Environment node."* The
honest version of that sentence, today, is: a drone project reading a **bundled, timestamped,
citable dataset**, with live fetching switched off unless someone has deliberately reviewed and
allowlisted a host.

**Acceptance.**

| Assertion | Threshold |
|---|---|
| Replay | all 24 hourly observations, in dataset order |
| Provenance | every published sample names dataset, provider, licence and observation timestamp |
| Reproducibility | two independent replays are identical; wrap-around is clean |
| Live weather off | refuses with a `requiredToSupport`; enabling it without an allowlist refuses |
| Allowlist | a non-allowlisted host is refused **without any network call**, and the refusal is audited |
| Unknown provider | refused, never defaulted |

## Why the dataset is synthetic, and why that is stated in the file

`services/environment/data/recorded-weather.json` is a seeded sum-of-harmonics series, CC0, with
its generating formulas recorded in the file itself. It is not an observation of anywhere. A real
archive would be better data and would arrive with a licence, an attribution obligation and a
fetch — and phase v07 established that this platform cannot make a silent fetch. The sibling
`README.md` says all of this, so nobody can mistake the dataset for a measurement of a real coast.

## The network boundary, precisely

A6 is the assertion that matters. The test installs a `fetchImpl` that flips a flag if it is ever
called, asks for `10.0.0.5`, and asserts the flag is **still false**. The refusal happens in
`LiveProvider.read` before any URL is constructed. There is no code path in
`packages/solvers/environment/weather.mjs` that fetches an arbitrary URL: the host must be an
exact string in the allowlist, and the URL is always `https://<allowlisted host><declared path>`.

The audit log records every attempt including refusals, with `allowed:false` and a reason, so
"we tried and were stopped" is distinguishable from "we never tried".

## What is unavailable

Tidal, geostrophic and eddy current fields; breaking waves and run-up; terrain elevation data.
All three are declared in `packages/solvers/environment/solver.mjs`, not quietly omitted.