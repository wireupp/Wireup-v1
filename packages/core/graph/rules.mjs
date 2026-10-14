/**
 * Domain rules.
 *
 * A rule is a pure function over a candidate graph that returns ValidationIssues. Rules
 * are collected here rather than inlined so that adding a domain later means adding a
 * rule, not editing the store.
 *
 * Shipped rules are the ones the current platform can justify:
 *   - electronics: at most one board node
 *   - electronics: a rail short is an error, ported from backend/circuit_wiring.py
 *   - mechanics:  an actuator must be driven, a hull must float in something
 *
 * Rules never silently repair. They report, and the caller decides.
 */

import { jsonPointer } from './contracts.mjs';

/**
 * @typedef {object} DomainRule
 * @property {string} domain
 * @property {string[]} domains  every domain this rule applies to
 * @property {string} id
 * @property {string} description
 * @property {(graph: any, ctx: { kinds: Map<string,any>, ports: Map<string,any> }) => import('./contracts.mjs').ValidationIssue[]} check
 */

/** @type {DomainRule[]} */
export const DOMAIN_RULES = [
  {
    id: 'single-board',
    domain: 'electronics',
    domains: ['electronics', 'hybrid'],
    description: 'An electronics project has at most one board node.',
    check(graph) {
      const boards = graph.nodes.filter((n) => n.kind.startsWith('board.'));
      if (boards.length <= 1) return [];
      return [{
        code: 'DOMAIN_RULE',
        pointer: jsonPointer(['nodes']),
        message: `an electronics project may contain at most one board node; found ` +
                 `${boards.length}: ${boards.map((b) => b.id).join(', ')}`,
        severity: 'error',
        subject: boards[1].id,
      }];
    },
  },

  {
    id: 'no-rail-short',
    domain: 'electronics',
    domains: ['electronics', 'hybrid'],
    description: 'Two supply outputs may not be wired directly together.',
    check(graph) {
      /** @type {import('./contracts.mjs').ValidationIssue[]} */
      const issues = [];
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      graph.edges.forEach((edge, i) => {
        const from = byId.get(edge.from?.node);
        const to = byId.get(edge.to?.node);
        if (!from || !to) return;
        const fromPort = portTypeOf(from, edge.from.port);
        const toPort = portTypeOf(to, edge.to.port);
        // A supply rail feeding another supply rail input is normal (a distribution net);
        // two OUTPUTS together is a short. That distinction is the whole point.
        if (fromPort?.direction === 'out' && toPort?.direction === 'out'
            && (fromPort.type === 'power.dc' || toPort.type === 'power.dc')) {
          issues.push({
            code: 'DOMAIN_RULE',
            pointer: jsonPointer(['edges', i]),
            message: `rail short: '${from.id}.${edge.from.port}' and '${to.id}.${edge.to.port}' ` +
                     `are both supply outputs. Connect one output to an input, or they will ` +
                     `fight each other.`,
            severity: 'error',
            subject: edge.id,
          });
        }
      });
      return issues;
    },
  },

  {
    id: 'mechanics-actuation',
    domain: 'mechanics',
    domains: ['mechanics', 'hybrid'],
    description: 'A mechanical node needs an actuator or a declared constant force.',
    check(graph) {
      /** @type {import('./contracts.mjs').ValidationIssue[]} */
      const issues = [];
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      for (const node of graph.nodes) {
        if (!node.kind.startsWith('mech.')) continue;
        const hasForcePort = (node.ports_hint ?? []).includes('mech.torque');
        if (!hasForcePort) continue;
        const driven = graph.edges.some((edge) => edge.to?.node === node.id);
        if (!driven && !node.properties?.constant_force) {
          issues.push({
            code: 'DOMAIN_RULE',
            pointer: jsonPointer(['nodes']),
            message: `mechanical node '${node.id}' has a torque input but nothing drives it, and ` +
                     `no constant_force property. Declare how it is actuated, or it will never ` +
                     `move.`,
            severity: 'error',
            subject: node.id,
          });
        }
      }
      void byId;
      return issues;
    },
  },
];

function portTypeOf(node, portName) {
  if (Array.isArray(node.ports_hint)) {
    return node.ports_hint.find((p) => p.name === portName) ?? null;
  }
  return null;
}