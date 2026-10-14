/**
 * GraphStore - the universal project store.
 *
 * Pure: no I/O, no React, no globals. It takes a graph and returns a new graph. That is
 * what lets the same store run in the browser, in a worker, on the server and in a test.
 *
 * Invariants enforced here, not merely documented:
 *   I2  every mutation requires expected_revision; a stale write changes nothing
 *   I3  a transaction either fully applies or changes nothing
 *   I4  undo is bounded to 50 snapshots, matching existing WireUp behaviour
 *   I7  an unknown kind, port or incompatible pair is an explicit error naming the offender
 */

import { clone, deepEqual, canonicalStringify } from './canonical.mjs';
import {
  canConnect, jsonPointer, loadKinds, loadPortTypes, validateGraphShape,
} from './contracts.mjs';
import { DOMAIN_RULES } from './rules.mjs';

export const MAX_UNDO = 50;
export const MAX_HISTORY = 200;

/**
 * @typedef {import('./contracts.mjs').ValidationIssue} ValidationIssue
 * @typedef {{ added: string[], removed: string[], modified: string[] }} NodeChanges
 * @typedef {{ added: string[], removed: string[], modified: string[] }} EdgeChanges
 * @typedef {{ nodes: NodeChanges, edges: EdgeChanges }} Changes
 * @typedef {object} Graph
 */

export class GraphStore {
  /** @param {Graph} graph */
  constructor(graph) {
    /** @private */ this._graph = clone(graph);
    /** @private @type {string[]} */ this._undo = [];
    /** @private @type {{ revision: number, operation: string, timestamp: string }[]} */ this._history = [];
    /** @private @type {Set<string>} */ this._undoable = new Set();
  }

  /** A deep-frozen copy. Callers can never mutate internal state. @returns {Graph} */
  read() {
    return deepFreeze(clone(this._graph));
  }

  /** @param {string} id */
  readNode(id) {
    const node = this._graph.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`node '${id}' does not exist in this graph`);
    return deepFreeze(clone(node));
  }

  /** @param {string} id */
  readEdge(id) {
    const edge = this._graph.edges.find((e) => e.id === id);
    if (!edge) throw new Error(`edge '${id}' does not exist in this graph`);
    return deepFreeze(clone(edge));
  }

  /** @returns {{ revision: number, operation: string, timestamp: string }[]} */
  history() {
    return this._history.map((h) => ({ ...h }));
  }

  /** @returns {string} */
  export() {
    return canonicalStringify(this._graph);
  }

  /** Containment children of a node. @param {string} id @returns {string[]} */
  childrenOf(id) {
    return this._graph.nodes.filter((n) => n.parent_id === id).map((n) => n.id);
  }

  /** Walk up the containment chain. Cycle-safe. @param {string} id @returns {string[]} */
  ancestorsOf(id) {
    const byId = new Map(this._graph.nodes.map((n) => [n.id, n]));
    /** @type {string[]} */
    const out = [];
    const seen = new Set([id]);
    let cursor = byId.get(id)?.parent_id ?? null;
    while (cursor && !seen.has(cursor)) {
      out.push(cursor);
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent_id ?? null;
    }
    return out;
  }

  /**
   * Apply a transaction.
   *
   * @param {object} tx
   * @param {string} tx.operation            the mutation name, recorded in history
   * @param {number} [tx.expected_revision]  required for any mutation
   * @param {Graph}  [tx.next]               the candidate graph. When omitted, the
   *                                        operation is derived from the payload below.
   * @param {(graph: Graph) => Graph} [tx.mutate]  a pure transform
   * @param {string[]} [tx.undoable]         operation names that participate in undo
   * @returns {{ ok: true, graph: Graph, revision: number, changes: Changes }
   *          | { ok: false, issues: ValidationIssue[] }}
   */
  apply(tx) {
    const mutating = tx.operation !== 'read';
    if (mutating && typeof tx.expected_revision !== 'number') {
      return {
        ok: false,
        issues: [{
          code: 'REVISION_STALE',
          pointer: '/expected_revision',
          message: `operation '${tx.operation}' requires expected_revision; got none. ` +
                   `Every mutation states which revision it was based on (invariant I2).`,
          severity: 'error',
        }],
      };
    }
    if (mutating && tx.expected_revision !== this._graph.revision) {
      return {
        ok: false,
        issues: [{
          code: 'REVISION_STALE',
          pointer: '/expected_revision',
          message: `expected_revision ${tx.expected_revision} but the project is at revision ` +
                   `${this._graph.revision}. Re-read the project and retry; nothing was changed.`,
          severity: 'error',
          subject: String(this._graph.revision),
        }],
      };
    }

    const before = this._graph;
    let candidate;
    try {
      candidate = tx.next ? clone(tx.next) : clone(tx.mutate ? tx.mutate(clone(before)) : before);
    } catch (error) {
      return {
        ok: false,
        issues: [{
          code: 'DOMAIN_RULE',
          pointer: '',
          message: `the mutation threw before producing a graph: ${String(error && error.message)}`,
          severity: 'error',
        }],
      };
    }

    if (!mutating) {
      return { ok: true, graph: deepFreeze(candidate), revision: candidate.revision, changes: emptyChanges() };
    }

    candidate.revision = before.revision + 1;
    candidate.updated_at = new Date().toISOString();

    const issues = validate(candidate);
    if (issues.some((i) => i.severity === 'error')) {
      // Nothing is written. The store is untouched - that is invariant I3.
      return { ok: false, issues };
    }

    const changes = diff(before, candidate);
    if (!tx.undoable || tx.undoable.includes(tx.operation)) {
      this._undo.push(canonicalStringify(before));
      if (this._undo.length > MAX_UNDO) this._undo = this._undo.slice(-MAX_UNDO); // I4
    }
    this._history = [
      ...this._history,
      { revision: candidate.revision, operation: tx.operation, timestamp: candidate.updated_at },
    ].slice(-MAX_HISTORY);

    this._graph = candidate;
    return {
      ok: true,
      graph: deepFreeze(clone(candidate)),
      revision: candidate.revision,
      changes,
      warnings: issues.filter((i) => i.severity === 'warning'),
    };
  }

  /**
   * Undo the last undoable mutation. Returns a failure rather than throwing when there is
   * nothing to undo, so a UI can render the state instead of crashing.
   */
  undo() {
    if (this._undo.length === 0) {
      return { ok: false, issues: [{
        code: 'DOMAIN_RULE', pointer: '', message: 'there is nothing to undo', severity: 'warning',
      }] };
    }
    const previous = this._undo.pop();
    const restored = JSON.parse(previous);
    this._graph = restored;
    this._history = [
      ...this._history,
      { revision: restored.revision, operation: 'undo', timestamp: new Date().toISOString() },
    ].slice(-MAX_HISTORY);
    return { ok: true, graph: deepFreeze(clone(restored)), revision: restored.revision, changes: emptyChanges() };
  }

  /** Can undo right now? */
  canUndo() {
    return this._undo.length > 0;
  }
}

// -------------------------------------------------------------- validation pipeline
/**
 * Validate a candidate graph. Runs every stage and returns ALL issues, so a caller sees
 * every problem at once instead of fixing them one at a time.
 *
 * @param {Graph} graph
 * @returns {ValidationIssue[]}
 */
export function validate(graph) {
  /** @type {ValidationIssue[]} */
  const issues = [...validateGraphShape(graph)];

  const kinds = loadKinds().byId;
  const ports = loadPortTypes().byId;
  const nodeById = new Map();

  // ---- 1. kinds exist, ids are unique and self-describing
  const seenIds = new Set();
  graph.nodes.forEach((node, i) => {
    if (typeof node.id !== 'string') return;
    if (seenIds.has(node.id)) {
      issues.push({ code: 'DUPLICATE_ID', pointer: jsonPointer(['nodes', i, 'id']),
        message: `node id '${node.id}' appears more than once`, severity: 'error', subject: node.id });
    }
    seenIds.add(node.id);
    nodeById.set(node.id, node);

    if (typeof node.kind !== 'string') return;
    if (!kinds.has(node.kind)) {
      issues.push({ code: 'UNKNOWN_KIND', pointer: jsonPointer(['nodes', i, 'kind']),
        message: `node '${node.id}' has kind '${node.kind}', which is not in contracts/kinds.json. ` +
                 `Unknown kinds are never coerced to a default.`,
        severity: 'error', subject: node.id });
      return;
    }
    // Only the node ID is normalised; the kind keeps its hyphens (`board.arduino-uno`).
    const prefix = node.kind.replace(/[.-]/g, '_').replace(/[^a-z0-9_]/g, '_');
    if (!node.id.startsWith(`${prefix}_`)) {
      issues.push({ code: 'ID_MISMATCH', pointer: jsonPointer(['nodes', i, 'id']),
        message: `node id '${node.id}' does not start with '${prefix}_' derived from its kind, ` +
                 `so it is not self-describing in an error message`,
        severity: 'warning', subject: node.id });
    }
  });

  // ---- 2. containment acyclicity
  for (const [id, node] of nodeById) {
    const parent = node.parent_id;
    if (!parent) continue;
    if (!nodeById.has(parent)) {
      issues.push({ code: 'DANGLING_ENDPOINT', pointer: '',
        message: `node '${id}' names parent '${parent}', which does not exist`, severity: 'error',
        subject: id });
      continue;
    }
    if (reaches(nodeById, parent, id)) {
      issues.push({ code: 'CYCLE', pointer: '',
        message: `containment cycle: '${id}' -> '${parent}' -> ... -> '${id}'`, severity: 'error',
        subject: id });
    }
  }

  // ---- 3. edges resolve, ports exist, types are compatible
  const seenEdgeIds = new Set();
  graph.edges.forEach((edge, i) => {
    const p = jsonPointer(['edges', i]);
    if (typeof edge.id === 'string') {
      if (seenEdgeIds.has(edge.id)) {
        issues.push({ code: 'DUPLICATE_ID', pointer: `${p}/id`,
          message: `edge id '${edge.id}' appears more than once`, severity: 'error', subject: edge.id });
      }
      seenEdgeIds.add(edge.id);
    }
    const from = nodeById.get(edge.from?.node);
    const to = nodeById.get(edge.to?.node);
    if (!from) {
      issues.push({ code: 'DANGLING_ENDPOINT', pointer: `${p}/from`,
        message: `edge '${edge.id ?? i}' starts at node '${edge.from?.node}', which does not exist`,
        severity: 'error' });
    }
    if (!to) {
      issues.push({ code: 'DANGLING_ENDPOINT', pointer: `${p}/to`,
        message: `edge '${edge.id ?? i}' ends at node '${edge.to?.node}', which does not exist`,
        severity: 'error' });
    }
    if (!from || !to) return;

    if (from === to) {
      const portsOfNode = kinds.get(from.kind)?.ports ?? [];
      const loopable = portsOfNode.some((port) => port.direction === 'inout');
      if (!loopable) {
        issues.push({ code: 'SELF_EDGE', pointer: p,
          message: `edge '${edge.id ?? i}' connects '${from.id}' to itself, but '${from.kind}' has ` +
                   `no inout port`, severity: 'error', subject: from.id });
        return;
      }
    }

    const fromPort = portOf(kinds, from, edge.from.port, issues, p, edge, 'from');
    const toPort = portOf(kinds, to, edge.to.port, issues, p, edge, 'to');
    if (!fromPort || !toPort) return;

    if (edge.kind && !ports.has(edge.kind)) {
      issues.push({ code: 'UNKNOWN_PORT', pointer: `${p}/kind`,
        message: `edge kind '${edge.kind}' is not a declared port type`, severity: 'error' });
    }
    if (!canConnect(fromPort.type, toPort.type)) {
      issues.push({ code: 'INCOMPATIBLE_PORT', pointer: p,
        message: `cannot connect '${from.id}.${edge.from.port}' (${fromPort.type}) to ` +
                 `'${to.id}.${edge.to.port}' (${toPort.type}): the types are not compatible. ` +
                 `This is a typed error, not a silently dropped connection.`,
        severity: 'error' });
    }
  });

  // ---- 4. domain rules
  for (const rule of DOMAIN_RULES) {
    if (graph.domain !== rule.domain && !rule.domains.includes(graph.domain)) continue;
    issues.push(...rule.check(graph, { kinds, ports }));
  }

  return issues;
}

/** @returns {any|undefined} */
function portOf(kinds, node, portName, issues, pointer, edge, side) {
  const kind = kinds.get(node.kind);
  if (!kind) return undefined;
  const found = (kind.ports ?? []).find((p) => p.name === portName);
  if (!found) {
    issues.push({ code: 'UNKNOWN_PORT', pointer: `${pointer}/${side}/port`,
      message: `node '${node.id}' (${node.kind}) has no port '${portName}'. Known ports: ` +
               `${(kind.ports ?? []).map((p) => p.name).join(', ') || '(none)'}`,
      severity: 'error', subject: node.id });
    return undefined;
  }
  return found;
}

/** Does `from` reach `target` by walking parent_id upward? */
function reaches(nodeById, from, target) {
  let cursor = nodeById.get(from)?.parent_id ?? null;
  const seen = new Set([from]);
  while (cursor && !seen.has(cursor)) {
    if (cursor === target) return true;
    seen.add(cursor);
    cursor = nodeById.get(cursor)?.parent_id ?? null;
  }
  return false;
}

// ----------------------------------------------------------------------- helpers
function emptyChanges() {
  return {
    nodes: { added: [], removed: [], modified: [] },
    edges: { added: [], removed: [], modified: [] },
  };
}

/** @returns {Changes} */
export function diff(before, after) {
  const changes = emptyChanges();
  const bNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const aNodes = new Map(after.nodes.map((n) => [n.id, n]));
  for (const [id, node] of aNodes) {
    if (!bNodes.has(id)) changes.nodes.added.push(id);
    else if (!deepEqual(bNodes.get(id), node)) changes.nodes.modified.push(id);
  }
  for (const id of bNodes.keys()) if (!aNodes.has(id)) changes.nodes.removed.push(id);

  const bEdges = new Map(before.edges.map((e) => [e.id, e]));
  const aEdges = new Map(after.edges.map((e) => [e.id, e]));
  for (const [id, edge] of aEdges) {
    if (!bEdges.has(id)) changes.edges.added.push(id);
    else if (!deepEqual(bEdges.get(id), edge)) changes.edges.modified.push(id);
  }
  for (const id of bEdges.keys()) if (!aEdges.has(id)) changes.edges.removed.push(id);
  return changes;
}

/** Recursively freeze so a caller cannot mutate store state through a returned object. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}