import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACTS_DIR = resolve(ROOT, 'contracts');
const INDEX_PATH = resolve(CONTRACTS_DIR, 'tools/index.json');
const GUIDE_PATH = resolve(ROOT, 'docs/AGENT_GUIDE.md');
const SESSION_TTL_DEFAULT = 60 * 60;
const SESSION_TTL_MAX = 8 * 60 * 60;
const SESSION_CALLS_PER_MINUTE = 60;
const LEGACY_COMMAND_PATH = (projectId) =>
  `/api/hardware/project/${encodeURIComponent(projectId)}/command`;
const sessions = new Map();
const callTimes = new Map();

function apiOrigin() {
  const value = process.env.WIREUP_API_URL ?? 'http://127.0.0.1:8000';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WIREUP_API_URL must be a loopback HTTP(S) origin.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hostname === 'localhost' || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (!loopback || !['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('WireUp MCP stdio only permits a loopback WIREUP_API_URL origin.');
  }
  return url.origin;
}

const API_ORIGIN = apiOrigin();
const CONTRACTS = await loadContracts();
const INDEX = JSON.parse(await readFile(INDEX_PATH, 'utf8'));
const TOOL_DEFINITIONS = INDEX.tools.map((entry) => {
  const contract = CONTRACTS.get(entry.contract);
  if (!contract) throw new Error(`MCP tool index refers to missing contract '${entry.contract}'.`);
  const canonicalName = contract.name.replaceAll('.', '_');
  if (canonicalName !== entry.mcp_name) {
    throw new Error(`MCP tool '${entry.contract}' must map to '${canonicalName}', not '${entry.mcp_name}'.`);
  }
  if (entry.handler !== 'session.create' && entry.handler !== 'project.create'
      && entry.handler !== 'project.read' && entry.handler !== 'project.delete'
      && !(contract.legacy_names ?? []).includes(entry.handler)) {
    throw new Error(`MCP handler '${entry.handler}' is not declared by contract '${entry.contract}'.`);
  }
  return { ...entry, contract, definition: toMcpDefinition(entry, contract) };
});

function toMcpDefinition(entry, contract) {
  const base = contract.args ?? { type: 'object', properties: {}, additionalProperties: false };
  const properties = { ...(base.properties ?? {}) };
  const required = [...(base.required ?? [])];
  if (entry.handler !== 'session.create') {
    properties.session_id = { type: 'string', minLength: 1, description: 'WireUp MCP session id.' };
    required.push('session_id');
  }
  if (contract.requires_review) {
    properties.review_approved = {
      type: 'boolean',
      const: true,
      description: 'Explicitly confirm this contract-marked review-gated operation.',
    };
    required.push('review_approved');
  }
  if (entry.handler === 'session.create') {
    properties.project_id = { type: 'string', minLength: 1, description: 'Bind to an existing local project.' };
    properties.ttl_seconds = { type: 'integer', minimum: 60, maximum: SESSION_TTL_MAX };
    properties.name = { type: 'string', minLength: 1, maxLength: 120, description: 'Name used when project.create is called.' };
    properties.board = { type: 'string', description: 'Default board for project.create.' };
  } else if (entry.handler === 'project.create') {
    properties.name = { type: 'string', minLength: 1, maxLength: 120 };
    properties.board = { type: 'string', description: 'Hardware board id, e.g. arduino-uno.' };
  } else if (entry.handler === 'project.delete') {
    properties.confirm = { type: 'boolean', const: true, description: 'Required explicit confirmation.' };
    required.push('confirm');
  }
  return {
    name: entry.mcp_name,
    description: [
      contract.summary ?? contract.title ?? contract.name,
      `Contract: ${contract.name}. MCP name mapping: ${contract.name} -> ${entry.mcp_name}.`,
      `Arguments: ${describeSchema(contract.args)}.`,
      `Result schema: ${JSON.stringify(contract.result)}.`,
      ...((contract.errors ?? []).map((error) => `Error ${error.code}: ${error.when}${error.retryable ? ' (retryable)' : ''}.`)),
      ...((contract.see_also ?? []).map((link) => `See also: ${link}.`)),
      contract.requires_review ? 'This operation is review-gated; pass review_approved:true only after explicit human approval.' : '',
      'Every call except session.create must include session_id. Calls are restricted to a local WireUp backend.',
    ].filter(Boolean).join(' '),
    inputSchema: {
      type: 'object',
      properties,
      required: [...new Set(required)],
      additionalProperties: false,
    },
    outputSchema: contract.result,
    annotations: {
      readOnlyHint: !contract.mutating,
      destructiveHint: ['node.remove', 'edge.remove', 'project.delete', 'runtime.stop'].includes(contract.name),
      idempotentHint: !contract.mutating,
    },
  };
}

function describeSchema(schema) {
  if (!schema || typeof schema !== 'object') return '(no arguments)';
  const describeFields = (current, prefix = '') => Object.entries(current.properties ?? {}).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const required = current.required?.includes(key) ? ' (required)' : '';
    const type = value.type ?? 'value';
    const description = value.description ? ` — ${value.description}` : '';
    const field = `${path}${required}: ${type}${description}`;
    if (type === 'object') return [field, ...describeFields(value, path)];
    if (type === 'array' && value.items?.type === 'object') {
      return [field, ...describeFields(value.items, `${path}[]`)];
    }
    return [field];
  });
  return describeFields(schema).join('; ') || '(no arguments)';
}

async function loadContracts() {
  const { readdir } = await import('node:fs/promises');
  const directory = resolve(CONTRACTS_DIR, 'tools');
  const names = await readdir(directory);
  const contracts = new Map();
  for (const name of names.filter((file) => file.endsWith('.tool.json'))) {
    const contract = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
    if (contracts.has(contract.name)) throw new Error(`Duplicate tool contract '${contract.name}'.`);
    contracts.set(contract.name, contract);
  }
  return contracts;
}

function scrub(value, runtimeToken) {
  if (Array.isArray(value)) return value.map((item) => scrub(item, runtimeToken));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/token|secret|credential|api.?key/i.test(key)) continue;
      result[key] = scrub(item, runtimeToken);
    }
    return result;
  }
  if (typeof value === 'string') {
    let text = runtimeToken ? value.split(runtimeToken).join('[REDACTED]') : value;
    text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
    return text;
  }
  return value;
}

async function apiRequest(path, { method = 'GET', body, runtimeToken } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const accessToken = process.env.WIREUP_ACCESS_TOKEN;
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (runtimeToken) headers['x-runtime-token'] = runtimeToken;
  let response;
  try {
    response = await fetch(new URL(path, API_ORIGIN), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (error) {
    throw new Error(`Cannot reach the local WireUp API at ${API_ORIGIN}: ${error.message}`);
  }
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { detail: `WireUp API returned a non-JSON response (HTTP ${response.status}).` };
  }
  if (!response.ok) {
    const detail = payload?.detail ?? payload?.message ?? `HTTP ${response.status}`;
    throw Object.assign(new Error(String(detail)), { status: response.status, payload });
  }
  return payload;
}

function safeToolError(error, runtimeToken) {
  const status = error?.status;
  const message = scrub(error?.message ?? 'WireUp tool failed.', runtimeToken);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    ...(status ? { _meta: { httpStatus: status } } : {}),
  };
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED: session does not exist; call session_create.');
  if (Date.now() >= session.expiresAt) {
    sessions.delete(sessionId);
    throw new Error('SESSION_EXPIRED: session expired; call session_create.');
  }
  const now = Date.now();
  const recent = (callTimes.get(sessionId) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= SESSION_CALLS_PER_MINUTE) {
    throw new Error('RATE_LIMITED: session exceeded 60 tool calls per minute; retry shortly.');
  }
  recent.push(now);
  callTimes.set(sessionId, recent);
  return session;
}

function requireProject(session) {
  if (!session.projectId) {
    throw new Error('PROJECT_REQUIRED: call project_create or create a session bound to project_id first.');
  }
}

async function bindProject(session, projectId) {
  const project = await apiRequest(`/api/hardware/projects/${encodeURIComponent(projectId)}`);
  session.projectId = project.id;
  session.runtimeToken = project.runtime_token;
  session.lastRevision = project.revision;
  return project;
}

async function createSession(args) {
  const ttlSeconds = Math.min(Math.max(Number(args.ttl_seconds ?? SESSION_TTL_DEFAULT), 60), SESSION_TTL_MAX);
  const session = {
    id: randomUUID(),
    projectId: null,
    runtimeToken: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlSeconds * 1000,
    defaultName: args.name ?? 'Untitled circuit',
    defaultBoard: args.board ?? 'unselected',
    lastRevision: null,
  };
  if (args.project_id) await bindProject(session, args.project_id);
  sessions.set(session.id, session);
  return {
    session_id: session.id,
    project_id: session.projectId,
    expires_at: new Date(session.expiresAt).toISOString(),
    capabilities: {
      tools: TOOL_DEFINITIONS.map((tool) => tool.mcp_name),
      simulation: 'run_simulation uses the legacy browser runtime and requires a connected browser; no headless worker is implemented.',
    },
  };
}

function validateArguments(value, schema, pointer = '') {
  const issues = [];
  const issue = (message) => issues.push(`${pointer || '/'} ${message}`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issue('must be an object');
      return issues;
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) issues.push(`${pointer}/${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key)) {
          issues.push(`${pointer}/${key} is not allowed`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) issues.push(...validateArguments(value[key], childSchema, `${pointer}/${key}`));
    }
    return issues;
  }
  if (schema.const !== undefined && value !== schema.const) issue(`must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) issue(`must be one of ${schema.enum.join(', ')}`);
  if (schema.type === 'string') {
    if (typeof value !== 'string') issue('must be a string');
    else if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) issue('has invalid length');
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) issue('must be an integer');
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) issue('must be a finite number');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    issue('must be a boolean');
  } else if (schema.type === 'array' && !Array.isArray(value)) {
    issue('must be an array');
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issue(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) issue(`must be <= ${schema.maximum}`);
  }
  return issues;
}

function hashArguments(args) {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

function revisionOf(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (Number.isInteger(value.revision)) return value.revision;
  if (Number.isInteger(value.project_revision)) return value.project_revision;
  if (value.project) return revisionOf(value.project);
  if (value.result) return revisionOf(value.result);
  return undefined;
}

async function invokeDefinition(entry, rawArgs) {
  const { contract } = entry;
  const problems = validateArguments(rawArgs, entry.definition.inputSchema);
  if (problems.length) {
    return { content: [{ type: 'text', text: `INVALID_ARGUMENTS: ${problems.join('; ')}` }], isError: true };
  }
  let session;
  if (entry.handler !== 'session.create') {
    try {
      session = getSession(rawArgs.session_id);
    } catch (error) {
      return safeToolError(error);
    }
  }
  if (contract.requires_review && rawArgs.review_approved !== true) {
    return {
      content: [{ type: 'text', text: 'REVIEW_REQUIRED: explicitly approve this operation by passing review_approved:true.' }],
      isError: true,
    };
  }

  const args = { ...rawArgs };
  delete args.session_id;
  delete args.review_approved;
  delete args.confirm;
  const start = Date.now();
  const before = session?.lastRevision;
  let resultCode = 'OK';
  try {
    let result;
    switch (entry.handler) {
      case 'session.create':
        result = await createSession(rawArgs);
        break;
      case 'project.create': {
        if (session.projectId) throw new Error('PROJECT_ALREADY_BOUND: create a fresh session before creating a different project.');
        const project = await apiRequest('/api/hardware/projects', {
          method: 'POST',
          body: { name: args.name ?? session.defaultName, board: args.board ?? session.defaultBoard },
        });
        session.projectId = project.id;
        session.runtimeToken = project.runtime_token;
        session.lastRevision = project.revision;
        result = scrub(project, session.runtimeToken);
        break;
      }
      case 'project.read':
      case 'read_project':
        requireProject(session);
        if (entry.handler === 'read_project') {
          result = await apiRequest(LEGACY_COMMAND_PATH(session.projectId), {
            method: 'POST', body: { name: 'read_project', args },
          });
        } else {
          result = await apiRequest(`/api/hardware/projects/${encodeURIComponent(session.projectId)}`);
        }
        session.lastRevision = revisionOf(result) ?? session.lastRevision;
        result = scrub(result, session.runtimeToken);
        break;
      case 'project.delete':
        requireProject(session);
        if (rawArgs.confirm !== true) throw new Error('CONFIRMATION_REQUIRED: pass confirm:true to delete the bound project.');
        result = await apiRequest(`/api/hardware/projects/${encodeURIComponent(session.projectId)}`, { method: 'DELETE' });
        session.projectId = null;
        session.runtimeToken = null;
        session.lastRevision = null;
        break;
      default: {
        requireProject(session);
        const commandArgs = { ...args };
        const runtimeToken = ['run_simulation', 'stop_simulation', 'read_simulation_results'].includes(entry.handler)
          ? session.runtimeToken : undefined;
        result = await apiRequest(LEGACY_COMMAND_PATH(session.projectId), {
          method: 'POST',
          body: { name: entry.handler, args: commandArgs, runtime_token: runtimeToken },
        });
        session.lastRevision = revisionOf(result) ?? session.lastRevision;
        result = scrub(result, session.runtimeToken);
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
  } catch (error) {
    resultCode = error?.status ? `HTTP_${error.status}` : (String(error.message).split(':', 1)[0] || 'ERROR');
    return safeToolError(error, session?.runtimeToken);
  } finally {
    console.error(JSON.stringify({
      event: 'mcp.tool',
      session_id: session?.id ?? null,
      actor: 'agent',
      tool: entry.mcp_name,
      args_hash: hashArguments(args),
      result_code: resultCode,
      duration_ms: Date.now() - start,
      project_revision_before: before ?? null,
      project_revision_after: session?.lastRevision ?? null,
    }));
  }
}

const server = new Server(
  { name: 'wireup', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS.map((tool) => tool.definition),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const entry = TOOL_DEFINITIONS.find((tool) => tool.mcp_name === request.params.name);
  if (!entry) return { content: [{ type: 'text', text: `UNKNOWN_TOOL: ${request.params.name}` }], isError: true };
  return invokeDefinition(entry, request.params.arguments ?? {});
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: 'wireup://capability', name: 'WireUp capability', mimeType: 'application/json' },
    { uri: 'wireup://docs/agent-guide', name: 'WireUp agent guide', mimeType: 'text/markdown' },
    { uri: 'wireup://docs/architecture', name: 'WireUp architecture', mimeType: 'text/markdown' },
    ...TOOL_DEFINITIONS.map((tool) => ({
      uri: `wireup://contracts/tools/${encodeURIComponent(tool.contract.name)}`,
      name: `Tool contract: ${tool.contract.name}`,
      mimeType: 'application/json',
    })),
  ],
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    { uriTemplate: 'wireup://project/{project_id}', name: 'Legacy project', mimeType: 'application/json' },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === 'wireup://capability') {
    return textResource(uri, await readFile(resolve(CONTRACTS_DIR, 'capability.json'), 'utf8'), 'application/json');
  }
  if (uri === 'wireup://docs/agent-guide') {
    return textResource(uri, await readFile(GUIDE_PATH, 'utf8'), 'text/markdown');
  }
  if (uri === 'wireup://docs/architecture') {
    return textResource(uri, await readFile(resolve(ROOT, 'docs/ARCHITECTURE.md'), 'utf8'), 'text/markdown');
  }
  const contractPrefix = 'wireup://contracts/tools/';
  if (uri.startsWith(contractPrefix)) {
    const name = decodeURIComponent(uri.slice(contractPrefix.length));
    const contract = CONTRACTS.get(name);
    if (!contract) throw new Error(`Unknown tool contract '${name}'.`);
    return textResource(uri, JSON.stringify(contract, null, 2), 'application/json');
  }
  const projectPrefix = 'wireup://project/';
  if (uri.startsWith(projectPrefix)) {
    const projectId = decodeURIComponent(uri.slice(projectPrefix.length));
    if (!/^[a-f0-9]{32}$/.test(projectId)) throw new Error('Invalid project id in resource URI.');
    const project = await apiRequest(`/api/hardware/projects/${encodeURIComponent(projectId)}`);
    return textResource(uri, JSON.stringify(scrub(project), null, 2), 'application/json');
  }
  throw new Error(`Unknown WireUp resource '${uri}'.`);
});

function textResource(uri, text, mimeType) {
  return { contents: [{ uri, mimeType, text }] };
}

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'build_project',
      description: 'Build a project through available local WireUp tools; read wireup://docs/agent-guide first.',
      arguments: [
        { name: 'goal', description: 'What should be built?', required: true },
        { name: 'domain', description: 'Project domain.', required: false },
        { name: 'constraints', description: 'Requirements and constraints.', required: false },
      ],
    },
    {
      name: 'diagnose_failure',
      description: 'Inspect a project and report observed failures without implying unavailable simulation.',
      arguments: [
        { name: 'project_id', description: 'Legacy project id.', required: true },
        { name: 'trial_id', description: 'Trial id, if a trial service is available.', required: false },
      ],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  if (name === 'build_project') {
    return {
      description: 'Build using the available local WireUp MCP surface.',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Read wireup://docs/agent-guide and wireup://capability first. Then use session_create, project_create, search_components, and the applicable build tools. The local API currently exposes legacy project operations; browser simulation requires an attached browser, and no headless runtime or trial service is implemented. Goal: ${args.goal ?? ''}\nDomain: ${args.domain ?? 'electronics'}\nConstraints: ${args.constraints ?? 'none provided'}`,
        },
      }],
    };
  }
  if (name === 'diagnose_failure') {
    return {
      description: 'Diagnose with observed project state and available compiler/simulation results.',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Read wireup://project/${encodeURIComponent(args.project_id ?? '')} and the relevant error results. Trial ${args.trial_id ?? '(not supplied)'} cannot be inspected because no trial service is implemented. Report exactly what evidence exists; do not retry blindly or claim an unrun simulation.`,
        },
      }],
    };
  }
  throw new Error(`Unknown WireUp prompt '${name}'.`);
});

function assertContractIndex() {
  const mappedContracts = new Set(TOOL_DEFINITIONS.map((tool) => tool.contract.name));
  const mappedHandlers = new Set(TOOL_DEFINITIONS.map((tool) => tool.handler));
  if (mappedContracts.size !== TOOL_DEFINITIONS.length || mappedHandlers.size !== TOOL_DEFINITIONS.length) {
    throw new Error('MCP tool index contains duplicate contracts or handlers.');
  }
  for (const entry of TOOL_DEFINITIONS) {
    if ((entry.contract.legacy_names ?? []).length === 0 && !entry.handler.includes('.')) {
      throw new Error(`MCP legacy handler '${entry.handler}' lacks a contract legacy_names entry.`);
    }
  }
}

assertContractIndex();
const transport = new StdioServerTransport();
await server.connect(transport);
