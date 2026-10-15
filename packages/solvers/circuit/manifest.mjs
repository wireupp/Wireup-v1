import { legacyBrowserSolver } from '../legacy-adapter.mjs';

export const circuitSolver = legacyBrowserSolver({
  id: 'circuit',
  version: '1',
  scopes: ['spice'],
  analyses: ['dc', 'tran'],
  limits: { maxNodes: 512, maxSimSeconds: 300, payloadBytes: 200000 },
  tests: ['analog/dc', 'analog/transient'],
  knownFailures: [],
  unavailable: [
    {
      feature: 'ac sweep',
      reason: 'The analog engine supports DC operating point and transient analysis only.',
      requiredToSupport: 'ngspice AC sweep implementation',
    },
    {
      feature: 'noise analysis',
      reason: 'Noise analysis is not implemented.',
      requiredToSupport: 'ngspice noise analysis implementation and verified fixtures',
    },
    {
      feature: 'temperature sweep',
      reason: 'Temperature sweeps are not implemented.',
      requiredToSupport: 'ngspice temperature sweep implementation and verified fixtures',
    },
  ],
});
