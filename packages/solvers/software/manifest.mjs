import { declaredUnavailableSolver } from '../legacy-adapter.mjs';

export const softwareSolver = declaredUnavailableSolver({
  id: 'software',
  version: '1',
  unavailable: [{
    feature: 'software simulation',
    reason: 'No verified sandboxed software solver is registered.',
    requiredToSupport: 'A sandboxed, resource-limited website runtime and verified device bridge.',
  }],
});
