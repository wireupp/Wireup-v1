import { validateManifest } from './protocol.mjs';

export class SolverRegistry {
  #solvers = new Map();
  #kindOwners = new Map();

  register(solver) {
    const manifest = validateManifest(solver?.manifest);
    if (this.#solvers.has(manifest.id)) {
      throw new Error(`Duplicate solver id '${manifest.id}'.`);
    }
    for (const kindId of manifest.kindIds) {
      const owner = this.#kindOwners.get(kindId);
      if (owner) throw new Error(`Kind '${kindId}' is claimed by both '${owner}' and '${manifest.id}'.`);
    }
    for (const method of ['prepare', 'run', 'dispose']) {
      if (typeof solver[method] !== 'function') {
        throw new TypeError(`Solver '${manifest.id}' is missing ${method}().`);
      }
    }
    this.#solvers.set(manifest.id, solver);
    for (const kindId of manifest.kindIds) this.#kindOwners.set(kindId, manifest.id);
    return solver;
  }

  get(id) {
    return this.#solvers.get(id);
  }

  list() {
    return [...this.#solvers.values()];
  }

  capabilities(verification = new Map()) {
    return this.list().map(({ manifest }) => ({
      ...manifest,
      confidence: verification.get(manifest.id)?.confidence ?? 'experimental',
    }));
  }

  solverFor(kindId) {
    const owner = this.#kindOwners.get(kindId);
    return owner ? this.#solvers.get(owner) : undefined;
  }
}
