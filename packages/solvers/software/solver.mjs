/**
 * The `software` solver, phase v12.
 *
 * What it actually does:
 *   - `software.computer`  a declared machine that owns children.
 *   - `software.web_app`   declared files, served from a loopback static server under a
 *                          strict CSP, probed by STATIC DOM analysis. No script engine runs.
 *   - `software.script`    a declared telemetry program, evaluated by the SAME expression
 *                          evaluator `packages/core/trials/probes.mjs` uses: a bounded, total,
 *                          side-effect-free expression language with no I/O of any kind.
 *
 * What it deliberately does NOT do, and says so in `unavailable`:
 *   - Execute agent-authored Python/Node. There is no OS-enforced network boundary on this
 *     platform (see the v07 report: Node `--permission` does not deny sockets, and WSL
 *     `unshare --net` is not permitted). Shipping a script sandbox without one would be
 *     claiming a security boundary that does not exist.
 *   - Run a browser, execute client-side JavaScript, or take screenshots. Those need code
 *     execution inside the sandbox, which is exactly what is refused.
 *   - Bridge to a live microcontroller session.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SolverUnavailable, validateManifest } from '../protocol.mjs';
import { withKindDefaults } from '../../core/graph/contracts.mjs';
import { domOperation, parseHtml } from './dom.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const KINDS = JSON.parse(readFileSync(resolve(ROOT, 'contracts/kinds.json'), 'utf8')).kinds;

const KIND_IDS = ['software.computer', 'software.script', 'software.web_app'].sort();

const TELEMETRY_CHANNELS = [
  'script.probe_value',
  'script.probe_count',
  'script.probe_ms',
  'web.attr',
  'web.document_bytes',
  'web.http_status',
  'web.load_ms',
  'web.text',
].sort();

const UNAVAILABLE = [
  {
    feature: 'client-side JavaScript execution in a web app',
    kind: 'software.web_app',
    reason: 'No script engine runs inside the sandbox. Probes read the served markup as data; behaviour that only appears after a script runs is not observable.',
    requiredToSupport: 'A headless browser renderer running under the same confinement, or an OS-enforced network namespace for the renderer process.',
  },
  {
    feature: 'agent-authored script execution',
    kind: 'software.script',
    reason: 'A script child process has no enforced network boundary on this platform, so arbitrary agent-authored code is refused rather than sandboxed.',
    requiredToSupport: 'An OS-enforced network namespace or seccomp filter for worker processes (blocked in v07).',
  },
  {
    feature: 'dependency installation',
    kind: 'software.script',
    reason: 'An agent cannot cause a package install. There is no vendored wheel set and no installer.',
    requiredToSupport: 'A hash-pinned, reviewed vendor directory plus an audited resolver.',
  },
  {
    feature: 'native compilation',
    kind: 'software.script',
    reason: 'Nothing is compiled or built inside the sandbox.',
    requiredToSupport: 'A hermetic build toolchain with no network access.',
  },
  {
    feature: 'screenshots and rendered previews',
    kind: 'software.web_app',
    reason: 'A screenshot needs a renderer that executes the page. The renderer is unavailable, so no screenshot artifact is produced.',
    requiredToSupport: 'A confined headless renderer; see the client-side JavaScript entry above.',
  },
  {
    feature: 'device bridge to a live microcontroller',
    kind: 'software.computer',
    reason: 'The serial/USB/Wi-Fi device bridge needs a running MCU session. No headless runtime worker exists (v07 blocker), so the bridge refuses.',
    requiredToSupport: 'A sandboxed headless runtime worker with an enforced network boundary.',
  },
  {
    feature: 'persistent storage across runs',
    kind: 'software.computer',
    reason: 'A run keeps only its telemetry recording. Nothing persists beyond the recording.',
    requiredToSupport: 'A declared, inspectable persistence layer with a migration and retention policy.',
  },
];

export const manifest = validateManifest({
  id: 'software',
  version: '1',
  kindIds: KIND_IDS,
  telemetryChannels: TELEMETRY_CHANNELS,
  analyses: ['point', 'probe'],
  limits: {
    maxNodes: 128,
    maxDocumentBytes: 1_048_576,
    maxRequests: 256,
    maxProbes: 256,
    wallClockMs: 10_000,
  },
  verification: {
    tests: [
      'software/hello-app',
      'software/dom-assert',
      'software/script',
      'software/limit',
    ],
  },
  knownFailures: [
    {
      code: 'STATIC_DOM_ONLY',
      condition: 'a web app renders its content with client-side JavaScript',
      message: 'Probes see the served markup, not a rendered DOM. Such an app is unverifiable here, not broken.',
    },
  ],
  unavailable: UNAVAILABLE,
});

async function selfTest() {
  const declared = new Set(KINDS.map((kind) => kind.id));
  for (const kindId of KIND_IDS) {
    if (!declared.has(kindId)) return false;
    const kind = KINDS.find((entry) => entry.id === kindId);
    if (!kind?.evidence?.length) return false;
    if (!kind.evidence.every((path) => existsSync(resolve(ROOT, path)))) return false;
  }
  return true;
}

async function prepare(graph, context) {
  if (!graph || !Array.isArray(graph.nodes)) throw new TypeError('Solver graph must contain nodes.');
  const unsupported = graph.nodes.find((node) => !KIND_IDS.includes(node.kind));
  if (unsupported) {
    throw new SolverUnavailable(
      `software simulation of '${unsupported.kind}'`,
      `The software solver does not simulate '${unsupported.kind}'.`,
      'A tested software implementation for this kind, with bench evidence.',
    );
  }
  // A kind's declared properties and defaults are its declaration; a node overrides them.
  const resolved = withKindDefaults(graph);
  const apps = resolved.nodes.filter((node) => node.kind === 'software.web_app');
  const programs = resolved.nodes.filter((node) => node.kind === 'software.script');
  return {
    solver: manifest.id,
    project_id: graph.project_id ?? graph.id,
    graph,
    apps: apps.map((node) => buildApp(node)),
    programs: programs.map((node) => buildProgram(node)),
    server: context?.server ?? null,
    runProbes: context?.runProbes ?? null,
  };
}

function buildApp(node) {
  const properties = node.properties ?? {};
  const files = properties.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new TypeError(`Web app '${node.id}' must declare a files object.`);
  }
  const entry = properties.entry ?? 'index.html';
  if (!Object.hasOwn(files, entry)) {
    throw new TypeError(`Web app '${node.id}' declares entry '${entry}' but does not declare that file.`);
  }
  if (properties.network?.deny_internet === false) {
    throw Object.assign(
      new TypeError(`Web app '${node.id}' requests internet access. Sandbox network egress policy does not permit it.`),
      { code: 'SANDBOX_NETWORK_DENIED' },
    );
  }
  return {
    id: node.id,
    entry,
    files: { ...files },
    framework: properties.framework ?? 'vanilla',
    dom_operations: Array.isArray(properties.dom_operations) ? properties.dom_operations.map((op) => ({ ...op })) : [],
  };
}

function buildProgram(node) {
  const properties = node.properties ?? {};
  const probes = properties.probes;
  if (!Array.isArray(probes) || !probes.length) {
    throw new TypeError(`Script '${node.id}' must declare at least one probe.`);
  }
  return { id: node.id, probes: probes.map((probe) => ({ ...probe })) };
}

/**
 * Serve the declared apps and probe them.
 *
 * Telemetry channels: `web.http_status` and `web.load_ms` per app (both measured), plus one
 * measured value per DOM probe. Nothing here is inferred or scored.
 */
async function run(plan, context) {
  return { solver_versions: { software: manifest.version }, telemetry: stream(plan, context) };
}

async function* stream(plan, context) {
  const graph = plan.graph;
  const { startStaticServer } = await import('../../../services/sandbox/supervisor.mjs');
  const runProbes = context?.runProbes ?? plan.runProbes;
  if (typeof runProbes !== 'function') {
    throw Object.assign(new Error('Software run requires the probe evaluator from packages/core/trials.'), {
      code: 'PROBE_EVALUATOR_UNAVAILABLE',
    });
  }
  const servers = [];
  const documents = new Map();
  try {
    for (const app of plan.apps) {
      const server = await startStaticServer({ files: app.files, entry: app.entry });
      servers.push(server);
      const startedAt = context?.clock?.now ? context.clock.now() : 0;
      const response = await fetch(`${server.origin}/${app.entry}`, {
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(server.limits.wall_clock_ms),
      });
      const body = await response.text();
      const loadMs = (context?.clock?.now ? context.clock.now() : 0) - startedAt;
      documents.set(app.id, parseHtml(body));
      yield {
        project_id: plan.project_id,
        t: 0,
        node: app.id,
        channel: 'web.http_status',
        value: response.status,
        unit: null,
        quality: 'measured',
        solver: manifest.id,
        source: { method: 'sandbox.static_server', origin: 'loopback', bytes: body.length, started_at: startedAt },
      };
      yield {
        project_id: plan.project_id,
        t: 0,
        node: app.id,
        channel: 'web.load_ms',
        value: loadMs,
        unit: 'ms',
        quality: 'measured',
        solver: manifest.id,
        source: { method: 'sandbox.static_server', origin: 'loopback' },
      };
      yield {
        project_id: plan.project_id,
        t: 0,
        node: app.id,
        channel: 'web.document_bytes',
        value: body.length,
        unit: 'bytes',
        quality: 'measured',
        solver: manifest.id,
        source: { method: 'sandbox.static_server', origin: 'loopback' },
      };
    }

    const results = await runProbes(collectProbes(plan, documents), {
      read: (target) => readTarget(target, documents, plan),
    });
    for (const result of results) {
      // A failed probe is PUBLISHED, not dropped: a probe that silently disappears is a probe
      // that cannot fail, and "the page renders correctly" must be expressible as arithmetic.
      yield {
        project_id: plan.project_id,
        t: 0,
        node: result.id,
        channel: 'script.probe_ok',
        value: result.ok ? 1 : 0,
        unit: null,
        quality: 'measured',
        solver: manifest.id,
        source: { method: 'probe', error: result.error?.code ?? null },
      };
      if (result.value === null || !['string', 'number', 'boolean'].includes(typeof result.value)) continue;
      yield {
        project_id: plan.project_id,
        t: 0,
        node: result.id,
        channel: 'script.probe_value',
        value: result.value,
        unit: result.unit,
        quality: result.ok ? result.quality : 'unavailable',
        solver: manifest.id,
        ...(result.ok ? {} : { value: null, source: { method: 'probe', error: result.error?.code ?? 'PROBE_FAILED' } }),
      };
    }
  } finally {
    for (const server of servers) await server.close();
  }
}

function collectProbes(plan, documents) {
  const probes = [];
  for (const app of plan.apps) {
    for (const operation of domOperationsFor(app)) probes.push(operation.probe);
  }
  for (const program of plan.programs) {
    // Namespace the probe id by its program, so two programs declaring `probe-1` cannot
    // overwrite each other in the telemetry stream.
    for (const probe of program.probes) {
      probes.push({ ...probe, id: `${program.id}/${probe.id ?? 'probe'}` });
    }
  }
  return probes;
}

/** Turn each app's declared DOM assertions into probe descriptors. */
export function domOperationsFor(app) {
  const operations = app.dom_operations ?? [];
  return operations.map((operation, index) => ({
    probe: {
      id: `${app.id}-dom-${operation.id ?? index}`,
      // The probe target is a scoped, validated object. `node` selects the app, and the
      // operation is one of the named ops in dom.mjs â€” never an expression over the DOM.
      target: {
        node: app.id,
        app: app.id,
        url_path: operation.url_path ?? '/',
        op: operation.op,
        selector: operation.selector ?? 'body',
        ...(operation.attribute ? { attribute: String(operation.attribute) } : {}),
      },
      expression: operation.expression ?? 'value',
      timeout_ms: 1000,
      ...(operation.expect ? { expect: operation.expect } : {}),
    },
  }));
}

function readTarget(target, documents, plan) {
  const app = plan.apps.find((entry) => entry.id === target.node) ?? plan.apps.find((entry) => entry.id === target.app);
  if (!app) {
    throw Object.assign(new Error(`Probe target '${target.node}' is not a declared app in this run.`), {
      code: 'PROBE_UNAVAILABLE',
    });
  }
  const document = documents.get(app.id);
  if (!document) {
    throw Object.assign(new Error(`Web app '${app.id}' produced no document.`), { code: 'PROBE_UNAVAILABLE' });
  }
  if (target.op) {
    const value = domOperation(document, target);
    return {
      state: { value },
      unit: typeof value === 'number' ? 'count' : null,
      quality: typeof value === 'number' ? 'measured' : 'measured',
    };
  }
  throw Object.assign(new Error('Probe target has no declared DOM operation.'), { code: 'PROBE_UNAVAILABLE' });
}

async function dispose(plan) {
  if (plan && typeof plan === 'object') {
    plan.apps = [];
    plan.programs = [];
  }
}

/** Stable hash of what was served, so a preview can be proven byte-identical to the trial. */
export function servedDigest(files) {
  const hash = createHash('sha256');
  for (const name of Object.keys(files).sort()) {
    hash.update(name).update('\0').update(String(files[name])).update('\0');
  }
  return hash.digest('hex');
}

export const softwareSolver = { manifest, selfTest, prepare, run, dispose };