import { notImplemented } from '../errors.mjs';

const graphTools = new Set([
  'project.create', 'project.read', 'project.delete', 'project.export',
  'node.add', 'node.remove', 'node.modify', 'edge.connect', 'edge.remove',
  'catalog.search', 'catalog.read_kind', 'session.create', 'capability.read',
  'calculator.evaluate', 'room.list',
]);

const legacyContractNames = new Map([
  ['read_project', 'read_project'],
  ['search_components', 'search_components'],
  ['add_component', 'add_component'],
  ['remove_component', 'remove_component'],
  ['modify_component', 'modify_component'],
  ['connect_wire', 'connect_wire'],
  ['remove_wire', 'remove_wire'],
  ['check_connections', 'check_connections'],
  ['generate_firmware', 'generate_firmware'],
  ['read_firmware', 'read_firmware'],
  ['edit_firmware', 'edit_firmware'],
  ['compile_firmware', 'compile_firmware'],
  ['run_simulation', 'run_simulation'],
  ['stop_simulation', 'stop_simulation'],
  ['read_simulation_results', 'read_simulation_results'],
  ['read_compiler_errors', 'read_compiler_errors'],
  ['calculator', 'calculator'],
  ['wire_circuit', 'wire_circuit'],
  ['validate_circuit', 'validate_circuit'],
  ['ask_project_questions', 'ask_project_questions'],
  ['assess_project_feasibility', 'assess_project_feasibility'],
  ['get_example_reference', 'get_example_reference'],
  ['search_example_requirements', 'search_example_requirements'],
]);

const unavailableByTool = new Map([
  ['bom.build', 'v14'],
  ['telemetry.read', 'v05'],
  ['trial.run', 'v05'],
  ['trial.sweep', 'v05'],
  ['trial.read', 'v05'],
]);

export function createHandlers(services, contractNames) {
  const handlers = Object.create(null);
  for (const [contract, legacyName] of legacyContractNames) {
    if (contractNames.has(contract)) {
      handlers[contract] = (args, context) => services.legacy.invoke(legacyName, args, context);
    }
  }
  for (const name of graphTools) {
    if (contractNames.has(name)) {
      handlers[name] = (args, context, definition) =>
        invokeGraphTool(name, args, context, services, definition);
    }
  }

  for (const name of contractNames) {
    if (handlers[name]) continue;
    const phase = unavailableByTool.get(name) ?? phaseFor(name);
    handlers[name] = () => notImplemented(phase, name);
  }
  return handlers;
}

function phaseFor(name) {
  if (name.startsWith('runtime.')) return 'v07';
  if (name.startsWith('trial.') || name === 'telemetry.read') return 'v05';
  if (name.startsWith('firmware.')) return 'v04';
  if (name.startsWith('capability.')) return 'v06';
  if (name.startsWith('bom.') || name.startsWith('assembly.')) return 'v14';
  if (name.startsWith('room.')) return 'v10';
  return 'v04';
}

async function invokeGraphTool(name, args, context, services, definition) {
  switch (name) {
    case 'project.create':
    case 'session.create':
      return services.persistence.create(args, context);
    case 'project.read':
      return context.store.read();
    case 'project.delete':
      return services.persistence.delete(context.projectId, context);
    case 'project.export':
      return context.store.export();
    case 'catalog.search':
      return services.catalog.search(args.query, args.limit, args.group);
    case 'catalog.read_kind':
      return services.catalog.readKind(args.kind);
    case 'capability.read':
      return services.persistence.capability(context.projectId, context);
    case 'room.list':
      return services.persistence.roomList(context);
    case 'calculator.evaluate':
      return services.legacy.invoke('calculator', args, context);
    case 'node.add':
      return applyGraphMutation(context, name, args, (graph) => {
        const node = args.node ?? args;
        graph.nodes.push(structuredClone(node));
        return graph;
      });
    case 'node.remove':
      return applyGraphMutation(context, name, args, (graph) => {
        const id = args.node_id ?? args.id;
        const index = graph.nodes.findIndex((node) => node.id === id);
        if (index < 0) throw namedError('UNKNOWN_KIND', `node '${id}' does not exist`);
        graph.nodes.splice(index, 1);
        graph.edges = graph.edges.filter((edge) => edge.from.node !== id && edge.to.node !== id);
        return graph;
      });
    case 'node.modify':
      return applyGraphMutation(context, name, args, (graph) => {
        const id = args.node_id ?? args.id;
        const node = graph.nodes.find((entry) => entry.id === id);
        if (!node) throw namedError('UNKNOWN_KIND', `node '${id}' does not exist`);
        Object.assign(node, structuredClone(args.patch ?? args.changes ?? {}));
        return graph;
      });
    case 'edge.connect':
      return applyGraphMutation(context, name, args, (graph) => {
        graph.edges.push(structuredClone(args.edge ?? args));
        return graph;
      });
    case 'edge.remove':
      return applyGraphMutation(context, name, args, (graph) => {
        const id = args.edge_id ?? args.id;
        const index = graph.edges.findIndex((edge) => edge.id === id);
        if (index < 0) throw namedError('INCOMPATIBLE_PORT', `edge '${id}' does not exist`);
        graph.edges.splice(index, 1);
        return graph;
      });
    default:
      return notImplemented(phaseFor(name), name);
  }
}

function applyGraphMutation(context, operation, args, mutate) {
  if (!context.store || typeof context.store.apply !== 'function') {
    throw namedError('NOT_IMPLEMENTED', 'GraphStore is not available in this tool context.');
  }
  const expectedRevision = args.expected_revision ?? context.expectedRevision;
  const result = context.store.apply({
    operation,
    expected_revision: expectedRevision,
    mutate,
  });
  if (!result.ok) {
    const first = result.issues?.find((issue) => issue.severity === 'error') ?? result.issues?.[0];
    throw namedError(first?.code ?? 'DOMAIN_RULE', first?.message ?? `${operation} was rejected.`, {
      pointer: first?.pointer,
      subject: first?.subject,
    });
  }
  return result.graph;
}

function namedError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}
