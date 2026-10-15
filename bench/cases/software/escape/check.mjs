import assert from 'node:assert/strict';
import { runProbes } from '../../../../packages/core/trials/probes.mjs';
import { softwareSolver } from '../../../../packages/solvers/software/solver.mjs';
import { CONTENT_SECURITY_POLICY, startStaticServer } from '../../../../services/sandbox/supervisor.mjs';

/**
 * Acceptance A1 — the escape corpus. ZERO escapes.
 *
 * This is not a "try to break it and see" suite. It is a demonstration that the corpus has
 * nowhere to land, because the sandbox never evaluates, compiles or spawns agent content. Each
 * entry states the attack, the mechanism that refuses it, and asserts that refusal.
 *
 * If a future phase adds a renderer, a script lane or a dependency installer, this case is the
 * one that must be extended before that phase can claim to be safe.
 */

const selected = process.argv[2];
if (selected !== undefined && !/^A\d$/.test(selected)) throw new TypeError(`Unknown selector '${selected}'.`);

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

const HTML_CORPUS = [
  { name: 'inline event handler', markup: '<p onclick="steal()">x</p>', code: 'INLINE_EVENT_HANDLER' },
  { name: 'remote script source', markup: '<script src="https://evil.example/x.js"></script>', code: 'REMOTE_SCRIPT_SOURCE' },
  { name: 'protocol-relative script', markup: '<script src="//evil.example/x.js"></script>', code: 'REMOTE_SCRIPT_SOURCE' },
  { name: 'javascript: URL', markup: '<a href="javascript:steal()">x</a>', code: 'JAVASCRIPT_URL' },
  { name: 'embedded frame', markup: '<iframe src="https://evil.example/"></iframe>', code: 'EMBEDDED_FRAME' },
  { name: 'img onerror', markup: '<img src="x" onerror="steal()">', code: 'INLINE_EVENT_HANDLER' },
];

check('A1', 'every markup escape in the corpus is refused before anything is served', async () => {
  for (const entry of HTML_CORPUS) {
    await assert.rejects(
      startStaticServer({ files: { 'index.html': entry.markup } }),
      (error) => {
        assert.equal(error.code, 'SANDBOX_MARKUP_REFUSED', `${entry.name}: wrong code ${error.code}`);
        assert.ok(error.violations.some((violation) => violation.code === entry.code),
          `${entry.name}: expected ${entry.code}, got ${error.violations.map((v) => v.code).join(', ')}`);
        return true;
      },
      `${entry.name} was NOT refused`,
    );
  }
});

check('A2', 'hostile probe expressions are rejected without evaluation', async () => {
  const corpus = [
    'process.env.GROQ_API_KEY', 'process.exit(1)', 'require("fs")', 'import("fs")',
    'globalThis', '__proto__.polluted = 1', 'constructor.prototype.x', 'this',
    'eval("1")', 'Function("return 1")()', 'child_process.execSync("id")',
    'fetch("https://evil.example")', 'require("child_process").fork()', 'new Array(1e12)',
    'while(true){}', 'for(;;){}', 'JSON.parse(process.env.SECRET)',
  ];
  const results = await runProbes(corpus.map((expression, index) => ({
    id: `escape-${index}`, target: { node: 'n' }, expression, timeout_ms: 500,
  })), { read: async () => ({ state: {}, quality: 'measured' }) });
  assert.equal(results.length, corpus.length);
  const executed = results.filter((result) => result.ok);
  assert.equal(executed.length, 0,
    `these hostile expressions were ACCEPTED: ${executed.map((r) => r.id).join(', ')}`);
  assert.ok(results.every((result) => typeof result.error?.code === 'string'));
});

check('A3', 'prototype pollution through a probe target is refused', async () => {
  const getterTarget = {};
  Object.defineProperty(getterTarget, 'node', {
    enumerable: true,
    get() {
      throw new Error('a getter on a probe target must never be invoked');
    },
  });
  const [result] = await runProbes([{
    id: 'getter', target: getterTarget, expression: '1', timeout_ms: 500,
  }], { read: async () => ({ state: {}, quality: 'measured' }) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_PROBE');
});

check('A4', 'a runtime token in a probe value is refused, not returned', async () => {
  const [result] = await runProbes([{
    id: 'token', target: { node: 'n' }, expression: 'value', timeout_ms: 500,
  }], {
    read: async () => ({
      state: { value: 'super-secret-token' },
      quality: 'measured',
      runtimeToken: 'super-secret-token',
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOKEN_FORBIDDEN');
  assert.equal(JSON.stringify(result).includes('super-secret-token'), false);
});

check('A5', 'the supervisor exposes no surface that could read the environment', async () => {
  const server = await startStaticServer({
    files: { 'index.html': '<p id="x">ok</p>' },
  });
  try {
    const response = await fetch(`${server.origin}/index.html`);
    const body = await response.text();
    for (const secret of Object.keys(process.env)) {
      const value = process.env[secret];
      if (!value || value.length < 8) continue;
      assert.equal(body.includes(value), false, `the environment value of ${secret} reached the page`);
    }
    assert.equal(body, '<p id="x">ok</p>', 'the served body is not the declared file');
    assert.match(CONTENT_SECURITY_POLICY, /connect-src 'none'/);
  } finally {
    await server.close();
  }
});

check('A6', 'the manifest declares every capability this corpus could otherwise exploit', async () => {
  const features = [
    'client-side JavaScript execution in a web app',
    'agent-authored script execution',
    'dependency installation',
    'native compilation',
    'screenshots and rendered previews',
    'device bridge to a live microcontroller',
    'persistent storage across runs',
  ];
  const declared = new Set(softwareSolver.manifest.unavailable.map((entry) => entry.feature));
  const missing = features.filter((feature) => !declared.has(feature));
  assert.deepEqual(missing, [], `the manifest does not declare: ${missing.join(', ')}`);
  assert.ok(softwareSolver.manifest.unavailable.every((entry) => entry.requiredToSupport.length > 20),
    'an unavailable entry without a concrete path forward is not an honest limit');
});

await Promise.all(pending);
if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`software/escape: ${passed} assertion(s) passed\n`);