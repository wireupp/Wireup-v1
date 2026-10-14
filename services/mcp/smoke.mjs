import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const serverPath = new URL('./server.mjs', import.meta.url);
const env = {
  PATH: process.env.PATH ?? '',
  WIREUP_API_URL: process.env.WIREUP_API_URL ?? 'http://127.0.0.1:8000',
};
if (process.env.WIREUP_ACCESS_TOKEN) env.WIREUP_ACCESS_TOKEN = process.env.WIREUP_ACCESS_TOKEN;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath.pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  cwd: root,
  env,
  stderr: 'inherit',
});
const client = new Client({ name: 'wireup-mcp-smoke', version: '1.0.0' });
let sessionId;
let projectId;

function parseToolJson(result) {
  const text = result.content?.find((part) => part.type === 'text')?.text;
  if (!text) throw new Error('MCP tool returned no text content.');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} failed: ${parseToolJson(result)}`);
  }
  return parseToolJson(result);
}

function schemaPaths(schema, prefix = '') {
  return Object.entries(schema.properties ?? {}).flatMap(([name, field]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    const nested = field.type === 'object'
      ? schemaPaths(field, path)
      : field.type === 'array' && field.items?.type === 'object'
        ? schemaPaths(field.items, `${path}[]`)
        : [];
    return [path, ...nested];
  });
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const index = JSON.parse(await readFile(resolve(root, 'contracts/tools/index.json'), 'utf8'));
  const expectedNames = index.tools.map((entry) => entry.mcp_name).sort();
  const actualNames = tools.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error('MCP tool list does not match the contract index.');
  }
  for (const entry of index.tools) {
    const tool = tools.tools.find((candidate) => candidate.name === entry.mcp_name);
    const contract = JSON.parse(await readFile(resolve(root, `contracts/tools/${entry.contract}.tool.json`), 'utf8'));
    if (!isDeepStrictEqual(tool.outputSchema, contract.result)) {
      throw new Error(`MCP tool '${tool.name}' has a mismatched output schema.`);
    }
    if (!tool.description.includes(contract.summary)) {
      throw new Error(`MCP tool '${tool.name}' description omits its contract summary.`);
    }
    for (const path of schemaPaths(contract.args)) {
      if (!tool.description.includes(path)) {
        throw new Error(`MCP tool '${tool.name}' description omits argument '${path}'.`);
      }
    }
    for (const error of contract.errors ?? []) {
      if (!tool.description.includes(`Error ${error.code}: ${error.when}`)) {
        throw new Error(`MCP tool '${tool.name}' description omits error ${error.code}.`);
      }
    }
    for (const link of contract.see_also ?? []) {
      if (!tool.description.includes(`See also: ${link}.`)) {
        throw new Error(`MCP tool '${tool.name}' description omits '${link}'.`);
      }
    }
  }
  const resources = await client.listResources();
  if (!resources.resources.some((resource) => resource.uri === 'wireup://capability')) {
    throw new Error('wireup://capability resource was not registered.');
  }
  const capability = await client.readResource({ uri: 'wireup://capability' });
  const capabilityText = capability.contents?.[0]?.text ?? '';
  if (!capabilityText.includes('generator_status')) throw new Error('Capability resource did not return the platform declaration.');

  const session = await call('session_create', { name: 'MCP smoke test', board: 'arduino-uno' });
  sessionId = session.session_id;
  if (!sessionId) throw new Error('session_create did not return a session id.');
  const project = await call('project_create', {
    session_id: sessionId,
    name: `MCP smoke ${Date.now()}`,
    board: 'arduino-uno',
  });
  projectId = project.id;
  if (!projectId || project.runtime_token) throw new Error('project_create omitted its id or leaked a runtime token.');

  const catalog = await call('search_components', { session_id: sessionId, query: 'led', limit: 20 });
  const led = catalog.components?.find((component) => component.id === 'led')
    ?? catalog.components?.find((component) => String(component.id).includes('led'));
  if (!led) throw new Error('Catalog search did not find an LED component.');

  await call('add_component', {
    session_id: sessionId,
    review_approved: true,
    expected_revision: project.revision,
    id: 'mcp-smoke-led',
    type: led.id,
    properties: {},
    x: 360,
    y: 180,
    rotation: 0,
  });
  const updated = await call('read_project', { session_id: sessionId });
  if (!updated.components?.some((component) => component.id === 'mcp-smoke-led')) {
    throw new Error('MCP could not observe the component added through its tool interface.');
  }
  if (updated.runtime_token) throw new Error('read_project exposed a runtime token.');
  console.log(`MCP smoke passed: ${tools.tools.length} indexed tools and schemas verified; created and read project ${projectId}; added ${led.id}.`);
} finally {
  if (projectId && sessionId) {
    try {
      await call('project_delete', { session_id: sessionId, confirm: true });
    } catch (error) {
      console.error(`MCP smoke cleanup failed for project ${projectId}: ${error.message}`);
    }
  }
  await client.close();
}
