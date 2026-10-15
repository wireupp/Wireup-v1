/**
 * Backwards-compatible entry point.
 *
 * Before v11 this module exported a solver that refused every request, which was the
 * honest state of the platform then. It now re-exports the real solver; the refusal lives
 * in the solver's `unavailable` manifest, where an agent can read it.
 */

export { mechanicsSolver } from './solver.mjs';