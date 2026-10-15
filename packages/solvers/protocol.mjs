export class SolverUnavailable extends Error {
  constructor(feature, reason, requiredToSupport) {
    super(requiredToSupport);
    this.name = 'SolverUnavailable';
    this.code = 'SOLVER_UNAVAILABLE';
    this.feature = feature;
    this.reason = reason;
    this.requiredToSupport = requiredToSupport;
  }
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('Solver manifest must be an object.');
  if (Object.hasOwn(manifest, 'confidence')) {
    throw new TypeError(`Solver '${manifest.id ?? '(unknown)'}' cannot self-declare confidence.`);
  }
  for (const field of ['id', 'version']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) {
      throw new TypeError(`Solver manifest ${field} must be a nonempty string.`);
    }
  }
  for (const field of ['kindIds', 'telemetryChannels', 'analyses', 'knownFailures', 'unavailable']) {
    if (!Array.isArray(manifest[field])) throw new TypeError(`Solver manifest ${field} must be an array.`);
  }
  if (!manifest.verification || !Array.isArray(manifest.verification.tests)) {
    throw new TypeError('Solver manifest verification.tests must be an array.');
  }
  if (!manifest.limits || typeof manifest.limits !== 'object' || Array.isArray(manifest.limits)) {
    throw new TypeError('Solver manifest limits must be an object.');
  }
  for (const field of ['kindIds', 'telemetryChannels', 'analyses']) {
    if (new Set(manifest[field]).size !== manifest[field].length) {
      throw new TypeError(`Solver manifest ${field} contains duplicate entries.`);
    }
  }
  return manifest;
}
