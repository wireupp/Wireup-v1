/**
 * Loss-preserving bridge between the public electronics project and the universal graph.
 *
 * Legacy-only fields are retained in graph metadata so a graph round-trip does not
 * discard UI state the graph contract does not model. Secret-bearing fields are omitted.
 */

import { clone } from '../canonical.mjs';
import { loadKinds } from '../contracts.mjs';
import { GraphStore } from '../store.mjs';

const ADAPTER_KEY = 'legacy_electronics';

/**
 * @typedef {Record<string, any>} LegacyProject
 * @typedef {Record<string, any>} LegacyComponent
 * @typedef {Record<string, any>} LegacyWire
 */

/**
 * @param {LegacyProject} project
 * @returns {any}
 */
export function fromLegacy(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new TypeError('legacy project must be an object');
  }
  if (!Array.isArray(project.components) || !Array.isArray(project.wires)) {
    throw new TypeError(`legacy project '${project.id ?? '(unknown)'}' must have components and wires arrays`);
  }
  if (!/^[a-f0-9]{32}$/.test(project.id ?? '')) {
    throw new TypeError(`legacy project id '${project.id ?? '(missing)'}' must be 32 lowercase hex characters`);
  }
  for (const field of ['created_at', 'updated_at']) {
    if (!isDateTime(project[field])) {
      throw new TypeError(`legacy project '${project.id}' has an invalid ${field}`);
    }
  }
  if (project.revision !== undefined && (!Number.isInteger(project.revision) || project.revision < 0)) {
    throw new TypeError(`legacy project '${project.id}' has an invalid revision`);
  }

  const kinds = loadKinds().byId;
  const nodeIds = Object.create(null);
  const warnings = [];
  const usedNodeIds = new Set();
  const legacyComponentIds = new Set();
  const nodes = project.components.map((component, index) => {
    if (!component || typeof component !== 'object' || typeof component.id !== 'string'
        || typeof component.type !== 'string') {
      throw new TypeError(`legacy project '${project.id}' component ${index} must have string id and type`);
    }
    if (legacyComponentIds.has(component.id)) {
      throw new TypeError(`legacy project '${project.id}' repeats component id '${component.id}'`);
    }
    legacyComponentIds.add(component.id);
    const matchingKinds = [...kinds.values()].filter((entry) =>
      entry.legacy_type === component.type || entry.id === component.type
      || entry.id.endsWith(`.${component.type}`));
    const kindDef = matchingKinds.length === 1 ? matchingKinds[0] : undefined;
    const kind = kindDef?.id ?? `part.unresolved_component`;
    const id = makeNodeId(kind, `${project.id}:${component.id}:${index}`, usedNodeIds);
    nodeIds[component.id] = id;
    if (!kindDef) {
      warnings.push({
        code: 'UNKNOWN_KIND',
        severity: 'warning',
        subject: component.id,
        message: `component '${component.id}' has ${matchingKinds.length > 1 ? 'ambiguous' : 'unresolved'} legacy type '${component.type}'; its original type is preserved`,
      });
    }
    const node = {
      id,
      kind,
      position: positionOf(component),
      ...(Number.isFinite(component.rotation) ? { rotation: component.rotation } : {}),
      properties: safeClone(component.properties && typeof component.properties === 'object'
        && !Array.isArray(component.properties) ? component.properties : {}),
    };
    if (!kindDef) node.properties.legacy_type = component.type;
    return node;
  });

  const edgeIds = new Set();
  const edges = project.wires.map((wire, index) => {
    if (!wire || typeof wire !== 'object' || !wire.from || !wire.to) {
      throw new TypeError(`legacy project '${project.id}' wire ${index} must have from and to endpoints`);
    }
    const fromNode = nodeIds[wire.from.component];
    const toNode = nodeIds[wire.to.component];
    const legacyEdgeId = typeof wire.id === 'string' && wire.id.length ? wire.id : `legacy_wire_${index}`;
    let edgeId = legacyEdgeId;
    if (edgeIds.has(edgeId)) {
      warnings.push({
        code: 'DUPLICATE_ID',
        severity: 'warning',
        subject: edgeId,
        message: `legacy wire id '${edgeId}' is repeated; the graph preserves the wire order`,
      });
      edgeId = `${legacyEdgeId}__${index}`;
      while (edgeIds.has(edgeId)) edgeId = `${edgeId}_`;
    }
    edgeIds.add(edgeId);
    if (!fromNode || !toNode) {
      warnings.push({
        code: 'DANGLING_ENDPOINT',
        severity: 'warning',
        subject: edgeId,
        message: `wire '${edgeId}' references a component that is not present in the legacy project`,
      });
    }
    const edge = {
      id: edgeId,
      from: { node: fromNode ?? `missing_${hash8(String(wire.from.component))}`, port: String(wire.from.pin ?? '') },
      to: { node: toNode ?? `missing_${hash8(String(wire.to.component))}`, port: String(wire.to.pin ?? '') },
      properties: { legacy_wire: safeClone(wire) },
    };
    const fromPort = portForNode(nodes, nodeIds, wire.from);
    const toPort = portForNode(nodes, nodeIds, wire.to);
    if (fromPort && toPort) edge.kind = fromPort.type;
    else {
      warnings.push({
        code: 'UNKNOWN_PORT',
        severity: 'warning',
        subject: edgeId,
        message: `wire '${edgeId}' could not resolve both legacy pin names; endpoints are preserved verbatim`,
      });
    }
    return edge;
  });

  const safeProject = safeClone(project, true);
  const metadata = safeClone(project.metadata && typeof project.metadata === 'object'
    ? project.metadata : {});
  metadata[ADAPTER_KEY] = {
    snapshot: safeProject,
    nodes: Object.fromEntries(project.components.map((component, index) => [
      nodeIds[component.id],
      { legacy_id: component.id, legacy_type: component.type, index },
    ])),
    warnings,
  };

  return {
    schema_version: 3,
    id: project.id,
    name: typeof project.name === 'string' ? project.name : 'Untitled circuit',
    domain: 'electronics',
    revision: Number.isInteger(project.revision) && project.revision >= 0 ? project.revision : 0,
    nodes,
    edges,
    ...(project.firmware ? { firmware: graphFirmware(project.firmware, project.board) } : {}),
    created_at: isDateTime(project.created_at) ? project.created_at : new Date(0).toISOString(),
    updated_at: isDateTime(project.updated_at) ? project.updated_at : new Date(0).toISOString(),
    metadata,
  };
}

/**
 * @param {any} graph
 * @returns {LegacyProject}
 */
export function toLegacy(graph) {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError('graph must contain nodes and edges arrays');
  }
  const adapter = graph.metadata?.[ADAPTER_KEY] ?? {};
  const snapshot = safeClone(adapter.snapshot ?? {});
  const origins = adapter.nodes ?? {};
  const kinds = loadKinds().byId;

  const components = graph.nodes.map((node, index) => {
    const origin = origins[node.id] ?? {};
    const kindDef = kinds.get(node.kind);
    const base = snapshot.components?.find((item) => item.id === origin.legacy_id) ?? {};
    const properties = safeClone(node.properties ?? {});
    if (node.kind === 'part.unresolved_component') {
      if (Object.prototype.hasOwnProperty.call(base.properties ?? {}, 'legacy_type')) {
        properties.legacy_type = safeClone(base.properties.legacy_type);
      } else {
        delete properties.legacy_type;
      }
    }
    const component = {
      ...clone(base),
      id: origin.legacy_id ?? properties.legacy_id ?? `component_${hash8(node.id ?? String(index))}`,
      type: kindDef?.legacy_type ?? origin.legacy_type ?? node.kind.split('.').at(-1),
      ...positionToLegacy(node.position),
      ...(typeof node.rotation === 'number' ? { rotation: node.rotation } : {}),
      properties,
    };
    return { component, index: Number.isInteger(origin.index) ? origin.index : index };
  }).sort((a, b) => a.index - b.index).map(({ component }) => component);

  const nodeToLegacy = new Map(graph.nodes.map((node) => [
    node.id,
    origins[node.id]?.legacy_id ?? node.properties?.legacy_id ?? node.id,
  ]));
  const wires = graph.edges.map((edge, index) => {
    const original = edge.properties?.legacy_wire;
    const wire = original && typeof original === 'object' ? clone(original) : {};
    return {
      ...wire,
      id: wire.id ?? edge.id ?? `wire_${index}`,
      from: {
        ...(wire.from ?? {}),
        component: nodeToLegacy.get(edge.from?.node) ?? wire.from?.component ?? edge.from?.node,
        pin: edge.from?.port ?? wire.from?.pin,
      },
      to: {
        ...(wire.to ?? {}),
        component: nodeToLegacy.get(edge.to?.node) ?? wire.to?.component ?? edge.to?.node,
        pin: edge.to?.port ?? wire.to?.pin,
      },
    };
  });

  const boardNode = graph.nodes.find((node) => node.kind.startsWith('board.'));
  const boardKind = boardNode ? kinds.get(boardNode.kind) : undefined;
  const result = {
    ...snapshot,
    id: graph.id,
    schema_version: snapshot.schema_version ?? 1,
    name: graph.name ?? snapshot.name,
    board: boardKind?.legacy_type ?? snapshot.board ?? 'unselected',
    components,
    wires,
    revision: graph.revision,
    created_at: graph.created_at,
    updated_at: graph.updated_at,
  };
  if (graph.firmware) {
    result.firmware = {
      ...(snapshot.firmware ?? {}),
      filename: graph.firmware.filename,
      source: graph.firmware.source,
      revision: graph.firmware.revision,
    };
  }
  delete result.runtime_token;
  return result;
}

/**
 * Apply a whole-project legacy change as one atomic graph transaction.
 *
 * @param {LegacyProject} before
 * @param {LegacyProject} after
 */
export function legacyDiff(before, after) {
  const source = fromLegacy(before);
  const target = fromLegacy(after);
  const store = new GraphStore(source);
  const operation = inferOperation(before, after);
  const applied = store.apply({
    operation,
    expected_revision: source.revision,
    next: { ...target, revision: source.revision },
  });
  if (!applied.ok) return { ...applied, warnings: target.metadata[ADAPTER_KEY].warnings };
  return {
    ...applied,
    legacy: toLegacy(applied.graph),
    warnings: target.metadata[ADAPTER_KEY].warnings,
  };
}

function inferOperation(before, after) {
  if (before.components?.length !== after.components?.length) return 'legacy.components';
  if (before.wires?.length !== after.wires?.length) return 'legacy.wires';
  if (before.firmware?.source !== after.firmware?.source) return 'legacy.firmware';
  return 'legacy.project';
}

function graphFirmware(firmware, board) {
  const extension = String(firmware.filename ?? '').split('.').at(-1)?.toLowerCase();
  const languages = { ino: 'arduino', py: 'python', c: 'c', h: 'c', js: 'javascript', html: 'html' };
  return {
    filename: typeof firmware.filename === 'string' && firmware.filename ? firmware.filename : 'sketch.ino',
    language: firmware.language ?? languages[extension] ?? 'arduino',
    source: typeof firmware.source === 'string' ? firmware.source : '',
    revision: Number.isInteger(firmware.revision) && firmware.revision >= 0 ? firmware.revision : 0,
    target_board: typeof board === 'string' ? board : null,
  };
}

function positionOf(component) {
  const position = {};
  if (Number.isFinite(component.x)) position.x = component.x;
  if (Number.isFinite(component.y)) position.y = component.y;
  return position;
}

function positionToLegacy(position) {
  return {
    ...(Number.isFinite(position?.x) ? { x: position.x } : {}),
    ...(Number.isFinite(position?.y) ? { y: position.y } : {}),
  };
}

function portForNode(nodes, nodeIds, endpoint) {
  const id = nodeIds[endpoint.component];
  const node = nodes.find((item) => item.id === id);
  if (!node) return undefined;
  return loadKinds().byId.get(node.kind)?.ports?.find((port) => port.name === endpoint.pin);
}

function makeNodeId(kind, seed, used) {
  const prefix = kind.replace(/[.-]/g, '_').replace(/[^a-z0-9_]/g, '_');
  let salt = 0;
  let id;
  do {
    id = `${prefix}_${hash8(`${seed}:${salt}`)}`;
    salt += 1;
  } while (used.has(id));
  used.add(id);
  return id;
}

function hash8(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function safeClone(value, root = false) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((item) => safeClone(item));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/token|secret|credential/i.test(key) || (root && key.startsWith('_'))) continue;
      result[key] = safeClone(item);
    }
    return result;
  }
  return clone(value);
}

function isDateTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
