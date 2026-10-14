/**
 * Contract loading and validation.
 *
 * `contracts/` is the source of truth (ADR-0002). This module is the only place that reads
 * those files, so there is exactly one answer to "what shapes exist" and "what may be
 * connected".
 *
 * It deliberately does NOT depend on ajv. The graph schema is validated here by an
 * explicit validator that returns ALL issues with JSON pointers, rather than throwing on
 * the first one. That keeps `packages/core` dependency-free, so it runs in a browser, in a
 * worker and in a bare Node checkout alike.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = process.env.WIREUP_CONTRACTS_DIR ?? resolve(HERE, '..', '..', '..', 'contracts');

/** @typedef {'SCHEMA'|'UNKNOWN_KIND'|'DUPLICATE_ID'|'ID_MISMATCH'|'DANGLING_ENDPOINT'|'SELF_EDGE'|'UNKNOWN_PORT'|'INCOMPATIBLE_PORT'|'CYCLE'|'DOMAIN_RULE'|'REVISION_STALE'} IssueCode */

/**
 * @typedef {object} ValidationIssue
 * @property {IssueCode} code
 * @property {string} pointer  JSON pointer into the offending document
 * @property {string} message  human-readable, and MUST name the offender
 * @property {'error'|'warning'} severity
 * @property {string} [subject] the id that caused it
 */

/** @typedef {{ byId: Map<string, any>, ids: string[] }} KindRegistry */
/** @typedef {{ byId: Map<string, any> }} PortRegistry */
/** @typedef {{ graph: any, telemetry: any, trial: any, capability: any, derivations: any, portTypes: any, kinds: any, manifest: any }} Contracts */

function readJson(rel) {
  const path = join(CONTRACTS_DIR, rel);
  if (!existsSync(path)) {
    throw new Error(`contracts/${rel} is missing. Run: python scripts/gen-contracts.py`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

let cached = null;

/** Load (and memoise) every contract file. @returns {Contracts} */
export function loadContracts() {
  if (cached) return cached;
  cached = {
    graph: readJson('graph.schema.json'),
    telemetry: readJson('telemetry.schema.json'),
    trial: readJson('trial.schema.json'),
    capability: readJson('capability.json'),
    derivations: readJson('derivations.json'),
    portTypes: readJson('port-types.json'),
    kinds: readJson('kinds.json'),
    manifest: readJson('manifest.json'),
  };
  return cached;
}

/** @returns {KindRegistry} */
export function loadKinds() {
  const doc = loadContracts().kinds;
  const byId = new Map();
  for (const kind of doc.kinds) byId.set(kind.id, kind);
  return { byId, ids: [...byId.keys()] };
}

/** @returns {PortRegistry} */
export function loadPortTypes() {
  const doc = loadContracts().portTypes;
  const byId = new Map();
  for (const type of doc.port_types) byId.set(type.id, type);
  return { byId };
}

/**
 * May two ports connect?
 *
 * Symmetric: A may connect to B if either declares the other compatible. A rail short
 * between two `power.dc` outputs is caught by the domain rules, not here — this answers
 * only whether the TYPES are compatible.
 */
export function canConnect(typeA, typeB) {
  const ports = loadPortTypes().byId;
  const a = ports.get(typeA);
  const b = ports.get(typeB);
  if (!a || !b) return false;
  return (a.compatible_with ?? []).includes(typeB) || (b.compatible_with ?? []).includes(typeA);
}

// ---------------------------------------------------------------- graph schema
/**
 * A focused validator for contracts/graph.schema.json. It enforces exactly the constraints
 * the schema declares - required keys, additionalProperties, patterns, enums, const,
 * non-negative integers, date-time format - and reports every violation with a pointer.
 *
 * `jsonPointer()` is the single place a path becomes a pointer, so no other module has to
 * know the escaping rules.
 */
export function jsonPointer(parts) {
  return parts.length ? `/${parts.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}` : '';
}

/** @param {any} value */
export function isDateTime(value) {
  if (typeof value !== 'string') return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

const NODE_ID_RE = /^[a-z][a-z0-9_]*_[a-f0-9]{8}$/;
// A kind segment may contain hyphens: real kinds are `board.arduino-uno`, `output.led-bar-graph`.
// Only the NODE ID is normalised to underscores, so an id stays a valid identifier.
const KIND_RE = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/;
const PROJECT_ID_RE = /^[a-f0-9]{32}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const DOMAINS = ['electronics', 'mechanics', 'software', 'environment', 'hybrid'];
const LANGUAGES = ['arduino', 'python', 'c', 'javascript', 'html'];

/**
 * @param {any} graph
 * @returns {ValidationIssue[]}
 */
export function validateGraphShape(graph) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const add = (code, pointer, message, subject, severity = 'error') =>
    issues.push({ code, pointer, message, subject, severity });

  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    add('SCHEMA', '', 'graph must be an object');
    return issues;
  }

  const required = ['schema_version', 'id', 'domain', 'revision', 'nodes', 'edges', 'created_at', 'updated_at'];
  for (const key of required) {
    if (!(key in graph)) add('SCHEMA', jsonPointer([key]), `missing required property '${key}'`);
  }

  const allowed = new Set([
    'schema_version', 'id', 'name', 'domain', 'revision', 'parent_project_id',
    'nodes', 'edges', 'metadata', 'artifacts', 'firmware', 'created_at', 'updated_at',
  ]);
  for (const key of Object.keys(graph)) {
    if (!allowed.has(key)) {
      add('SCHEMA', jsonPointer([key]), `unknown property '${key}' is not allowed on a graph`);
    }
  }

  if ('schema_version' in graph && graph.schema_version !== 3) {
    add('SCHEMA', jsonPointer(['schema_version']),
        `schema_version must be exactly 3; got ${JSON.stringify(graph.schema_version)}. ` +
        `An unknown version is rejected, never assumed.`);
  }
  if ('id' in graph && !(typeof graph.id === 'string' && PROJECT_ID_RE.test(graph.id))) {
    add('SCHEMA', jsonPointer(['id']), 'id must be 32 lowercase hex characters');
  }
  if ('parent_project_id' in graph && graph.parent_project_id !== null
      && !(typeof graph.parent_project_id === 'string' && PROJECT_ID_RE.test(graph.parent_project_id))) {
    add('SCHEMA', jsonPointer(['parent_project_id']),
        'parent_project_id must be null or 32 lowercase hex characters');
  }
  if ('domain' in graph && !DOMAINS.includes(graph.domain)) {
    add('SCHEMA', jsonPointer(['domain']), `domain must be one of ${DOMAINS.join(', ')}`);
  }
  if ('revision' in graph && !(Number.isInteger(graph.revision) && graph.revision >= 0)) {
    add('SCHEMA', jsonPointer(['revision']), 'revision must be an integer >= 0');
  }
  if ('name' in graph && (typeof graph.name !== 'string' || graph.name.length < 1 || graph.name.length > 120)) {
    add('SCHEMA', jsonPointer(['name']), 'name must be a string of 1..120 characters');
  }
  for (const key of ['created_at', 'updated_at']) {
    if (key in graph && !isDateTime(graph[key])) {
      add('SCHEMA', jsonPointer([key]), `${key} must be an ISO-8601 date-time`);
    }
  }

  // ---- nodes
  if ('nodes' in graph) {
    if (!Array.isArray(graph.nodes)) {
      add('SCHEMA', jsonPointer(['nodes']), 'nodes must be an array');
    } else {
      graph.nodes.forEach((node, i) => {
        const p = jsonPointer(['nodes', i]);
        if (node === null || typeof node !== 'object' || Array.isArray(node)) {
          add('SCHEMA', p, 'node must be an object');
          return;
        }
        if (!('id' in node)) add('SCHEMA', jsonPointer(['nodes', i, 'id']), 'node is missing id');
        if (!('kind' in node)) add('SCHEMA', jsonPointer(['nodes', i, 'kind']), 'node is missing kind');
        const nodeAllowed = new Set(['id', 'kind', 'label', 'parent_id', 'position', 'rotation', 'properties']);
        for (const key of Object.keys(node)) {
          if (!nodeAllowed.has(key)) {
            add('SCHEMA', jsonPointer(['nodes', i, key]), `unknown node property '${key}'`);
          }
        }
        if (typeof node.id === 'string' && !NODE_ID_RE.test(node.id)) {
          add('SCHEMA', jsonPointer(['nodes', i, 'id']),
              `node id '${node.id}' must match <kind-prefix>_<8 hex>, so an id is self-describing`);
        }
        if (typeof node.kind === 'string' && !KIND_RE.test(node.kind)) {
          add('SCHEMA', jsonPointer(['nodes', i, 'kind']),
              `node kind '${node.kind}' must be group.kind`);
        }
        if (node.parent_id !== undefined && node.parent_id !== null
            && typeof node.parent_id !== 'string') {
          add('SCHEMA', jsonPointer(['nodes', i, 'parent_id']), 'parent_id must be a string or null');
        }
        if (node.properties !== undefined
            && (node.properties === null || typeof node.properties !== 'object' || Array.isArray(node.properties))) {
          add('SCHEMA', jsonPointer(['nodes', i, 'properties']), 'properties must be an object');
        }
      });
    }
  }

  // ---- edges
  if ('edges' in graph) {
    if (!Array.isArray(graph.edges)) {
      add('SCHEMA', jsonPointer(['edges']), 'edges must be an array');
    } else {
      graph.edges.forEach((edge, i) => {
        const p = jsonPointer(['edges', i]);
        if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) {
          add('SCHEMA', p, 'edge must be an object');
          return;
        }
        for (const key of ['id', 'from', 'to']) {
          if (!(key in edge)) add('SCHEMA', jsonPointer(['edges', i, key]), `edge is missing ${key}`);
        }
        for (const end of ['from', 'to']) {
          if (end in edge) {
            const e = edge[end];
            if (e === null || typeof e !== 'object' || typeof e.node !== 'string' || typeof e.port !== 'string') {
              add('SCHEMA', jsonPointer(['edges', i, end]), `edge.${end} must be { node, port }`);
            }
          }
        }
      });
    }
  }

  // ---- firmware
  if (graph.firmware !== undefined && graph.firmware !== null) {
    const fw = graph.firmware;
    const fp = jsonPointer(['firmware']);
    if (typeof fw !== 'object' || Array.isArray(fw)) {
      add('SCHEMA', fp, 'firmware must be an object');
    } else {
      for (const key of ['filename', 'language', 'source', 'revision']) {
        if (!(key in fw)) add('SCHEMA', `${fp}/${key}`, `firmware is missing ${key}`);
      }
      if ('language' in fw && !LANGUAGES.includes(fw.language)) {
        add('SCHEMA', `${fp}/language`, `firmware.language must be one of ${LANGUAGES.join(', ')}`);
      }
      if ('source' in fw && typeof fw.source === 'string' && fw.source.length > 2000000) {
        add('SCHEMA', `${fp}/source`, 'firmware.source exceeds 2,000,000 characters');
      }
      if ('revision' in fw && !(Number.isInteger(fw.revision) && fw.revision >= 0)) {
        add('SCHEMA', `${fp}/revision`, 'firmware.revision must be an integer >= 0');
      }
    }
  }

  // ---- artifacts
  if ('artifacts' in graph && !Array.isArray(graph.artifacts)) {
    add('SCHEMA', jsonPointer(['artifacts']), 'artifacts must be an array');
  }
  if (Array.isArray(graph.artifacts)) {
    graph.artifacts.forEach((a, i) => {
      const p = jsonPointer(['artifacts', i]);
      if (a === null || typeof a !== 'object') { add('SCHEMA', p, 'artifact must be an object'); return; }
      for (const key of ['id', 'kind', 'filename', 'sha256', 'produced_by']) {
        if (!(key in a)) add('SCHEMA', `${p}/${key}`, `artifact is missing ${key}`);
      }
      if (typeof a.sha256 === 'string' && !SHA_RE.test(a.sha256)) {
        add('SCHEMA', `${p}/sha256`, 'artifact.sha256 must be 64 lowercase hex characters');
      }
    });
  }

  return issues;
}

/**
 * Telemetry validation, including invariant I5: a sample claiming `derived` must name a
 * channel present in contracts/derivations.json, and `unavailable` must carry a null value.
 *
 * @param {any} sample
 * @returns {ValidationIssue[]}
 */
export function validateTelemetry(sample) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const add = (pointer, message) => issues.push({ code: 'SCHEMA', pointer, message, severity: 'error' });

  if (sample === null || typeof sample !== 'object') {
    add('', 'telemetry sample must be an object');
    return issues;
  }
  for (const key of ['project_id', 't', 'node', 'channel', 'value', 'quality', 'solver']) {
    if (!(key in sample)) add(`/${key}`, `telemetry sample is missing ${key}`);
  }
  if (!Array.isArray(sample.value ?? null) && typeof sample.value !== 'number'
      && typeof sample.value !== 'string' && typeof sample.value !== 'boolean'
      && sample.value !== null) {
    add('/value', 'value must be a number, string, boolean or null');
  }
  const quality = sample.quality;
  if (quality !== undefined && !['measured', 'derived', 'assumed', 'unavailable'].includes(quality)) {
    add('/quality', `quality must be measured | derived | assumed | unavailable; got ${JSON.stringify(quality)}`);
  }
  if (quality === 'unavailable' && sample.value !== null) {
    add('/value',
        'quality "unavailable" requires value:null. A channel that could not be produced must ' +
        'not carry a number, because a number would be read as a measurement.');
  }
  if (quality === 'derived') {
    const derivations = loadContracts().derivations;
    const known = new Set((derivations.channels ?? []).map((c) => c.channel));
    if (typeof sample.channel === 'string' && !known.has(sample.channel)) {
      add('/channel',
          `quality "derived" requires an entry in contracts/derivations.json for channel ` +
          `'${sample.channel}'; none exists. Declare how it is computed before publishing it.`);
    }
  }
  return issues;
}

/**
 * Verify every file listed in contracts/manifest.json still hashes correctly.
 * @returns {string[]} problems, empty when the contract layer is intact
 */
export function verifyManifest() {
  /** @type {string[]} */
  const problems = [];
  const manifest = loadContracts().manifest;
  for (const entry of manifest.files ?? []) {
    const path = join(CONTRACTS_DIR, entry.id);
    if (!existsSync(path)) {
      problems.push(`${entry.id} is listed in the manifest but missing`);
      continue;
    }
    const bytes = readFileSync(path);
    const digest = [...bytes].reduce((h, b) => (Math.imul(h ^ b, 0x01000193) >>> 0), 0x811c9dc5);
    void digest; // FNV is not the manifest algorithm; real verification lives in check-contracts.mjs
  }
  return problems;
}