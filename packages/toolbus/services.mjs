import { notImplemented } from './errors.mjs';

const phaseByFeature = {
  runtime: 'v07',
  telemetry: 'v05',
  trials: 'v05',
  solvers: 'v06',
  bom: 'v14',
  assembly: 'v14',
  software: 'v12',
  mechanics: 'v11',
};

function missingService(name, phase, feature = name) {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === 'then') return undefined;
      return (..._args) => notImplemented(phase, `${feature}.${String(property)}`);
    },
  });
}

export function createStubServices(overrides = {}) {
  const defaults = {
    catalog: missingService('catalog', 'v04'),
    compiler: missingService('compiler', 'v04'),
    runtime: missingService('runtime', phaseByFeature.runtime),
    telemetry: missingService('telemetry', phaseByFeature.telemetry),
    trials: missingService('trials', phaseByFeature.trials),
    solvers: missingService('solvers', phaseByFeature.solvers),
    persistence: missingService('persistence', 'v04'),
    legacy: missingService('legacy', 'v04'),
    review: missingService('review', 'v04'),
    bom: missingService('bom', phaseByFeature.bom),
    assembly: missingService('assembly', phaseByFeature.assembly),
    clock: { now: () => Date.now() },
    rng: (seed) => seededRng(seed),
  };
  const services = { ...defaults, ...overrides };
  for (const key of Object.keys(defaults)) {
    if (services[key] === undefined || services[key] === null) {
      throw new TypeError(`ToolServices.${key} must be provided.`);
    }
  }
  return services;
}

function seededRng(seed) {
  let state = Number(seed) >>> 0;
  return {
    next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
    },
  };
}

export const notImplementedPhases = Object.freeze({ ...phaseByFeature });
