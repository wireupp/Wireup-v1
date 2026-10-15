/**
 * Backwards-compatible entry point.
 *
 * Before v12 this exported a solver that refused every request. It now re-exports the real
 * software solver, whose `unavailable` array still refuses script execution, client-side
 * JavaScript, screenshots, dependency installation and the device bridge.
 */

export { softwareSolver } from './solver.mjs';