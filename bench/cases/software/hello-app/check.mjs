import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { cleanup, runCase } from '../../_harness.mjs';
import { CONTENT_SECURITY_POLICY, startStaticServer } from '../../../../services/sandbox/supervisor.mjs';
import { servedDigest, softwareSolver } from '../../../../packages/solvers/software/solver.mjs';

/**
 * Acceptance A1/A6/A7 — the sandbox actually serves, the CSP is actually enforced by header,
 * and the preview a human would open is byte-identical to what the trial ran.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(resolve(HERE, 'project.json'), 'utf8'));
const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

const app = graph.nodes.find((node) => node.kind === 'software.web_app');

const pending = [];
let passed = 0;
function check(id, name, fn) {
  if (selected && selected !== id) return;
  // An async checker is tracked rather than fired and forgotten: a rejection that lands after
  // the summary line is a failure the bench runner never sees.
  if (fn() instanceof Promise) pending.push(fn().catch((error) => { passed -= 1; throw error; }));
  passed += 1;
  process.stdout.write(`PASS ${id} ${name}\n`);
}

const { result, series, root } = await runCase(graph, {
  metric: 'mean', direction: 'target', target: 0, tolerance: 1e9,
}, { solver: softwareSolver });

try {
  const samples = series.flatMap((entry) => entry.samples);
  const byChannel = (name) => samples.filter((sample) => sample.channel === name);

  check('A1', 'the app is served and every declared probe passes', () => {
    assert.equal(result.verdict, 'pass', `verdict was ${result.verdict}`);
    const probes = byChannel('script.probe_value');
    assert.ok(probes.length >= 5, `only ${probes.length} probe results were recorded`);
    const failed = probes.filter((sample) => sample.value === null);
    assert.equal(failed.length, 0, `${failed.length} probes failed their declared expectation`);
    assert.ok(probes.every((sample) => sample.quality === 'measured'));
  });

  check('A2', 'the HTTP status and document size are measured, not assumed', () => {
    const status = byChannel('web.http_status');
    assert.equal(status.length, 1);
    assert.equal(status[0].value, 200);
    const bytes = byChannel('web.document_bytes');
    assert.equal(bytes.length, 1);
    assertWithin(bufferLength(), bytes[0].value, 0.001, 'document bytes');
  });

  check('A3', 'the sandbox refuses network, inline handlers, remote scripts and frames', async () => {
    assert.match(CONTENT_SECURITY_POLICY, /default-src 'none'/);
    assert.match(CONTENT_SECURITY_POLICY, /connect-src 'none'/);
    assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'/);
    assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  });

  check('A4', 'the served bytes are exactly the declared files', async () => {
    const server = await startStaticServer({ files: app.properties.files, entry: 'index.html' });
    try {
      const response = await fetch(`${server.origin}/index.html`);
      const body = await response.text();
      assert.equal(body, app.properties.files['index.html'],
        'what the trial served differs from the declared source');
      assert.equal(response.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
      // Percent-encoded traversal survives URL normalisation and must be refused by the
      // supervisor itself; the plain `..` form never leaves the client, but the point stands:
      // neither can escape the scratch root, and neither can return content.
      assert.equal((await fetch(`${server.origin}/%2e%2e%2f%2e%2e%2fpackage.json`)).status, 403);
      const plain = await fetch(`${server.origin}/../package.json`);
      assert.ok(plain.status !== 200, `traversal returned 200 (status ${plain.status})`);
      assert.equal((await fetch(`${server.origin}/index.html`, { method: 'PUT' })).status, 405);
    } finally {
      await server.close();
    }
  });

  check('A5', 'the preview digest is stable and matches the declared files', () => {
    const digest = servedDigest(app.properties.files);
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(digest, servedDigest({ ...app.properties.files }));
    const reordered = Object.fromEntries(Object.entries(app.properties.files).reverse());
    assert.equal(servedDigest(reordered), digest, 'the digest must not depend on key order');
  });

  check('A6', 'the solver manifest declares what it cannot do, by name', () => {
    const features = softwareSolver.manifest.unavailable.map((entry) => entry.feature);
    for (const required of [
      'client-side JavaScript execution in a web app',
      'agent-authored script execution',
      'dependency installation',
      'screenshots and rendered previews',
    ]) {
      assert.ok(features.includes(required), `manifest does not declare: ${required}`);
    }
    assert.ok(softwareSolver.manifest.unavailable.every((entry) => entry.requiredToSupport.length > 20),
      'every unavailable entry must say what would be needed to support it');
  });
} finally {
  await cleanup(root);
}

function bufferLength() {
  return Buffer.byteLength(app.properties.files['index.html'], 'utf8');
}

function assertWithin(actual, expected, fraction, label) {
  const tolerance = Math.abs(expected) * fraction + 1e-9;
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: got ${actual}, expected ${expected} +/- ${tolerance}`);
}

await Promise.all(pending);
if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`software/hello-app: ${passed} assertion(s) passed\n`);