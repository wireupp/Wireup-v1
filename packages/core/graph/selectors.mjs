/**
 * Pure read helpers over a graph. Used identically by the UI, the MCP surface and solvers.
 *
 * Deliberately a fixed set of functions rather than a query language: a query language
 * would be a second thing to learn and a second thing to get wrong.
 */

import { loadKinds } from './contracts.mjs';

/** @param {any} graph @param {string} kind */
export function byKind(graph, kind) {
  return graph.nodes.filter((n) => n.kind === kind);
}

/** @param {any} graph @param {string} group  e.g. 'sensor', 'board' */
export function byKindGroup(graph, group) {
  return graph.nodes.filter((n) => n.kind.startsWith(`${group}.`));
}

/** Nodes with no parent. @param {any} graph */
export function roots(graph) {
  return graph.nodes.filter((n) => !n.parent_id);
}

/** @param {any} graph @param {string} nodeId */
export function neighbours(graph, nodeId) {
  const out = new Set();
  for (const edge of graph.edges) {
    if (edge.from?.node === nodeId) out.add(edge.to?.node);
    if (edge.to?.node === nodeId) out.add(edge.from?.node);
  }
  return [...out].filter(Boolean);
}

/** @param {any} graph @param {string} nodeId */
export function portsOf(graph, nodeId) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const kind = loadKinds().byId.get(node.kind);
  return kind?.ports ?? [];
}

/** Nodes that publish a signal: anything with an out or inout signal port. @param {any} graph */
export function sensorsFor(graph) {
  return graph.nodes.filter((n) =>
    portsOf(graph, n.id).some((p) => p.direction !== 'in' && String(p.type).startsWith('signal.')));
}

/** Nodes that consume a signal and can therefore be actuated. @param {any} graph */
export function actuatorsFor(graph) {
  return graph.nodes.filter((n) =>
    portsOf(graph, n.id).some((p) => p.direction !== 'out' && String(p.type).startsWith('signal.')));
}

/** Undirected path between two nodes, or null. Used by "is X connected to Y" checks. */
export function pathBetween(graph, fromId, toId) {
  if (fromId === toId) return [fromId];
  const queue = [[fromId]];
  const seen = new Set([fromId]);
  while (queue.length) {
    const path = /** @type {string[]} */ (queue.shift());
    const tail = path[path.length - 1];
    for (const next of neighbours(graph, tail)) {
      if (seen.has(next)) continue;
      const extended = [...path, next];
      if (next === toId) return extended;
      seen.add(next);
      queue.push(extended);
    }
  }
  return null;
}

/**
 * Coarse bill of materials from the graph.
 *
 * Prices come from `contracts/kinds.json` only. A kind with no declared price yields a
 * null price and is reported as unpriced - never estimated, never defaulted.
 */
export function bomOf(graph) {
  const kinds = loadKinds().byId;
  const lines = new Map();
  for (const node of graph.nodes) {
    const kind = kinds.get(node.kind);
    const group = kind?.group ?? 'unknown';
    const key = `${group}:${node.kind}`;
    const existing = lines.get(key);
    const price = kind?.properties?.unit_price ?? null;
    if (existing) {
      existing.quantity += 1;
    } else {
      lines.set(key, {
        node_kind: node.kind,
        label: kind?.label ?? node.kind,
        group,
        quantity: 1,
        unit_price: typeof price === 'number' ? price : null,
        simulated: kind?.simulated ?? false,
        scope: kind?.scope ?? 'none',
      });
    }
  }
  const result = [...lines.values()].sort((a, b) =>
    a.group.localeCompare(b.group) || a.node_kind.localeCompare(b.node_kind));
  const priced = result.filter((l) => l.unit_price !== null);
  return {
    lines: result,
    priced_items: priced.length,
    unpriced_items: result.length - priced.length,
    // A partial total presented as a total is a lie, so there is no total unless all lines
    // carry a price.
    total: priced.length === result.length && result.length > 0
      ? { amount: Math.round(priced.reduce((s, l) => s + l.unit_price * l.quantity, 0) * 100) / 100,
          currency: null, price_source: 'contracts/kinds.json' }
      : null,
    total_note: priced.length !== result.length
      ? `${result.length - priced.length} of ${result.length} items have no declared price; ` +
        `no total is shown rather than a partial one.`
      : null,
  };
}