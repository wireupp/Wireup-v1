import { SolverRegistry } from './registry.mjs';
import { circuitSolver } from './circuit/manifest.mjs';
import { mcuSolver } from './mcu/manifest.mjs';
import { mechanicsSolver } from './mechanics/manifest.mjs';
import { environmentSolver } from './environment/manifest.mjs';
import { softwareSolver } from './software/manifest.mjs';

export function createSolverRegistry() {
  const registry = new SolverRegistry();
  for (const solver of [circuitSolver, mcuSolver, mechanicsSolver, environmentSolver, softwareSolver]) {
    registry.register(solver);
  }
  return registry;
}

export const solverRegistry = createSolverRegistry();
