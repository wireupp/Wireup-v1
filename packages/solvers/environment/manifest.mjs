/**
 * Backwards-compatible entry point.
 *
 * Before v11 this exported a solver that refused every request. It now re-exports the real
 * environment solver; the refusal that still stands — live weather is off — lives in the
 * manifest's `unavailable` array and in `weather.mjs`.
 */

export { environmentSolver } from './solver.mjs';