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
let secondSessionId;
let secondProjectId;
let sharedSessionId;

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
  const buildPrompt = await client.getPrompt({
    name: 'build_project',
    arguments: { goal: 'smoke-test' },
  });
  const buildInstructions = buildPrompt.messages?.[0]?.content?.text ?? '';
  for (const requiredStep of ['wireup://docs/agent-guide', 'wireup://capability', 'session_create', 'capability_read', 'project_create', 'search_components']) {
    if (!buildInstructions.includes(requiredStep)) {
      throw new Error(`build_project prompt omits required available step '${requiredStep}'.`);
    }
  }
  if (!buildInstructions.includes('no headless runtime')) {
    throw new Error('build_project prompt does not disclose that headless runtime is unavailable.');
  }

  const session = await call('session_create', { name: 'MCP smoke test', board: 'arduino-uno' });
  sessionId = session.session_id;
  if (!sessionId) throw new Error('session_create did not return a session id.');
  const expiredSessionResult = await client.callTool({
    name: 'read_project',
    arguments: { session_id: 'expired-session-smoke-check' },
  });
  if (!expiredSessionResult.isError || expiredSessionResult._meta?.code !== 'SESSION_EXPIRED') {
    throw new Error('An expired or unknown session did not return SESSION_EXPIRED.');
  }
  const declaredCapability = await call('capability_read', { session_id: sessionId });
  if (!isDeepStrictEqual(declaredCapability, JSON.parse(capabilityText))) {
    throw new Error('capability_read does not match wireup://capability.');
  }
  const explainedCapability = await call('capability_explain', {
    session_id: sessionId,
    kind: 'board.esp32-c3',
  });
  if (explainedCapability.simulated !== false
      || !explainedCapability.limitations?.some((entry) => entry.reason.includes('0x514c26'))) {
    throw new Error('capability_explain did not return the exact ESP32-C3 limitation.');
  }
  const project = await call('project_create', {
    session_id: sessionId,
    name: `MCP smoke ${Date.now()}`,
    board: 'arduino-uno',
  });
  projectId = project.id;
  if (!projectId || project.runtime_token) throw new Error('project_create omitted its id or leaked a runtime token.');
  const projectCapability = await call('capability_read', { session_id: sessionId });
  if (!Array.isArray(projectCapability.project?.nodes)
      || !projectCapability.project.nodes.some((node) => node.kind === 'board.arduino-uno' && node.simulated)) {
    throw new Error('capability_read did not resolve the project board against generated capability.');
  }
  const secondSession = await call('session_create', { name: 'MCP scope test', board: 'arduino-uno' });
  secondSessionId = secondSession.session_id;
  if (!secondSessionId) throw new Error('second session_create did not return a session id.');
  const secondProject = await call('project_create', {
    session_id: secondSessionId,
    name: `MCP scope ${Date.now()}`,
    board: 'arduino-uno',
  });
  secondProjectId = secondProject.id;
  if (!secondProjectId || secondProjectId === projectId || secondProject.runtime_token) {
    throw new Error('second project_create did not return an isolated project.');
  }
  const isolatedProjectRead = await call('read_project', { session_id: secondSessionId });
  if (isolatedProjectRead.id !== secondProjectId
      || isolatedProjectRead.components?.some((component) => component.id === 'mcp-smoke-led')) {
    throw new Error('A session bound to a different project observed another project state.');
  }
  const sharedSession = await call('session_create', {
    name: 'MCP shared-project revision test',
    project_id: projectId,
  });
  sharedSessionId = sharedSession.session_id;
  if (!sharedSessionId || sharedSession.project_id !== projectId) {
    throw new Error('session_create did not bind the second session to the requested project.');
  }
  const scopedProjectResource = `wireup://project/${projectId}?session_id=${sessionId}`;
  const resourceProject = await client.readResource({ uri: scopedProjectResource });
  const resourceProjectData = JSON.parse(resourceProject.contents?.[0]?.text ?? 'null');
  if (resourceProjectData?.id !== projectId) throw new Error('Session-bound project resource returned the wrong project.');
  let unscopedResourceRejected = false;
  try {
    await client.readResource({ uri: `wireup://project/${projectId}` });
  } catch {
    unscopedResourceRejected = true;
  }
  if (!unscopedResourceRejected) throw new Error('Project resource was readable without a bound session.');
  let crossSessionResourceRejected = false;
  try {
    await client.readResource({
      uri: `wireup://project/${projectId}?session_id=${secondSessionId}`,
    });
  } catch {
    crossSessionResourceRejected = true;
  }
  if (!crossSessionResourceRejected) throw new Error('A different session could read the project resource.');
  const scopedByBoundSession = await client.readResource({
    uri: `wireup://project/${projectId}?session_id=${sharedSessionId}`,
  });
  if (JSON.parse(scopedByBoundSession.contents?.[0]?.text ?? 'null')?.id !== projectId) {
    throw new Error('A session explicitly bound to the project could not read its project resource.');
  }

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
  const refreshedProjectResource = await client.readResource({ uri: scopedProjectResource });
  const refreshedProject = JSON.parse(refreshedProjectResource.contents?.[0]?.text ?? 'null');
  if (!refreshedProject?.components?.some((component) => component.id === 'mcp-smoke-led')) {
    throw new Error('Session-bound project resource did not reflect the MCP mutation.');
  }
  const staleResult = await client.callTool({
    name: 'add_component',
    arguments: {
      session_id: sharedSessionId,
      review_approved: true,
      expected_revision: project.revision,
      id: 'mcp-smoke-stale',
      type: led.id,
      properties: {},
      x: 420,
      y: 180,
      rotation: 0,
    },
  });
  const staleText = parseToolJson(staleResult);
  if (!staleResult.isError || staleResult._meta?.code !== 'REVISION_STALE'
      || !String(staleText).includes('Re-read the project')) {
    throw new Error('A stale mutation did not return the actionable REVISION_STALE error.');
  }
  const recoveredProject = await call('read_project', { session_id: sharedSessionId });
  if (!Number.isInteger(recoveredProject.revision) || recoveredProject.revision <= project.revision) {
    throw new Error('The second session could not re-read the latest project revision after a stale write.');
  }
  await call('add_component', {
    session_id: sharedSessionId,
    review_approved: true,
    expected_revision: recoveredProject.revision,
    id: 'mcp-smoke-recovered',
    type: led.id,
    properties: {},
    x: 420,
    y: 180,
    rotation: 0,
  });
  const recoveredView = await call('read_project', { session_id: sessionId });
  if (!recoveredView.components?.some((component) => component.id === 'mcp-smoke-recovered')) {
    throw new Error('A successful retry after re-reading was not visible to the other bound session.');
  }
  console.log(`MCP smoke passed: ${tools.tools.length} indexed tools and schemas verified; capability tool matches resource; session-bound resource and stale-revision recovery verified; created and read project ${projectId}; added ${led.id}.`);
} finally {
  if (projectId && sessionId) {
    try {
      await call('project_delete', { session_id: sessionId, confirm: true });
    } catch (error) {
      console.error(`MCP smoke cleanup failed for project ${projectId}: ${error.message}`);
    }
  }
  if (secondProjectId && secondSessionId) {
    try {
      await call('project_delete', { session_id: secondSessionId, confirm: true });
    } catch (error) {
      console.error(`MCP smoke cleanup failed for project ${secondProjectId}: ${error.message}`);
    }
  }
  await client.close();
}
