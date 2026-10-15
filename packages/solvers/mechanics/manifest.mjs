import { declaredUnavailableSolver } from '../legacy-adapter.mjs';

export const mechanicsSolver = declaredUnavailableSolver({
  id: 'mechanics',
  version: '1',
  unavailable: [{
    feature: 'mechanics simulation',
    reason: 'No verified mechanics solver is registered.',
    requiredToSupport: 'A deterministic, verified mechanics solver and actuator coupling.',
  }],
});
