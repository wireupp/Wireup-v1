import { declaredUnavailableSolver } from '../legacy-adapter.mjs';

export const environmentSolver = declaredUnavailableSolver({
  id: 'environment',
  version: '1',
  unavailable: [{
    feature: 'environment simulation',
    reason: 'No verified environment solver is registered.',
    requiredToSupport: 'A verified environmental solver with measured-quality outputs.',
  }],
});
