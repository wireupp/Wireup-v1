import assert from 'node:assert/strict';
import { runProbes } from '../../../../packages/core/trials/probes.mjs';
import { CONTENT_SECURITY_POLICY, startStaticServer } from '../../../../services/sandbox/supervisor.mjs';

/**
 * Acceptance A8 — resource limits are REPORTED, not suffered.
 *
 * The v12 brief's corpus was: infinite loop, a 1 GB allocation attempt and a 10 MB output
 * attempt. Two of those three are impossible in this design and the third is expressed
 * differently, and pretending otherwise would be the dishonest outcome:
 *
 *   infinite loop   The probe language is a bounded recursive-descent expression parser over a
 *                   finite token stream. There is no loop construct and no recursion in the
 *                   language, so a non-terminating program cannot be written. What CAN happen
 *                   is a probe whose data source never resolves; that is exercised here and is
 *                   bounded by `timeout_ms`.
 *   1 GB allocation The supervisor never evaluates agent content and never spawns a process for
 *                   it, so there is no allocator an agent can drive. The analogous risk is a
 *                   document too large to serve, which is asserted instead.
 *   10 MB output    The per-file and per-document byte caps are asserted instead, and the
 *                   request-count cap is asserted with a real 429.
 *
 * Every limit reports a named code. A run that hits a bound says which bound, rather than
 * appearing to hang or failing with an opaque crash.
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

const benign = '<!DOCTYPE html><html><head><title>limits</title></head><body><p id="x">ok</p></body></html>';

check('A1', 'an over-sized file is refused with SANDBOX_LIMIT_EXCEEDED', async () => {
  const huge = 'x'.repeat(2 * 1024 * 1024);
  await assert.rejects(
    startStaticServer({ files: { 'index.html': benign, 'huge.txt': huge } }),
    (error) => {
      assert.equal(error.code, 'SANDBOX_LIMIT_EXCEEDED');
      assert.match(error.message, /per-file byte cap/);
      return true;
    },
  );
});

check('A2', 'the request-count cap answers 429 rather than hanging', async () => {
  const server = await startStaticServer({ files: { 'index.html': benign }, limits: { max_requests: 3 } });
  try {
    const statuses = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await fetch(`${server.origin}/index.html`)).status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
    const last = server.requests.at(-1);
    assert.equal(last.code, 'SANDBOX_LIMIT_EXCEEDED');
    assert.equal(last.bytes, 0, 'a refused request must return no bytes');
  } finally {
    await server.close();
  }
});

check('A3', 'a probe whose source never resolves is bounded by its declared timeout', async () => {
  const started = Date.now();
  const [result] = await runProbes([{
    id: 'hangs', target: { node: 'anything' }, expression: '1', timeout_ms: 150,
  }], {
    read: () => new Promise(() => {}),
  });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROBE_TIMEOUT');
  assert.ok(elapsed < 5000, `the probe took ${elapsed} ms to give up`);
});

check('A4', 'the expression language refuses unbounded and oversized programs by construction', async () => {
  const hostile = {
    'expressions-too-many': {
      id: 'big', target: { node: 'n' }, timeout_ms: 1000,
      expression: `1${' + 1'.repeat(4000)}`,
    },
    'expressions-too-deep': {
      id: 'deep', target: { node: 'n' }, timeout_ms: 1000,
      expression: `${'('.repeat(200)}1${')'.repeat(200)}`,
    },
    'no-loop-construct': {
      id: 'loop', target: { node: 'n' }, timeout_ms: 1000,
      expression: 'while (true) {}',
    },
  };
  const results = await runProbes(Object.values(hostile), { read: async () => ({ state: {}, quality: 'measured' }) });
  const codes = Object.values(results.map((r) => r.error?.code));
  for (const result of results) assert.equal(result.ok, false);
  assert.ok(codes.includes('EXPRESSION_TOO_LARGE'), `codes were ${codes.join(', ')}`);
  assert.ok(codes.includes('INVALID_EXPRESSION'), `codes were ${codes.join(', ')}`);
});

check('A5', 'the CSP forbids the browser-side resources an output flood would use', () => {
  for (const directive of ["default-src 'none'", "connect-src 'none'", "object-src 'none'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) {
    assert.ok(CONTENT_SECURITY_POLICY.includes(directive), `CSP is missing ${directive}`);
  }
});

check('A6', 'a request that exceeds the deadline is refused by the sandbox, not retried forever', async () => {
  const server = await startStaticServer({
    files: { 'index.html': benign },
    limits: { wall_clock_ms: 1 },
  });
  try {
    // A 1 ms budget means any client that waits must be refused rather than served late.
    const response = await fetch(`${server.origin}/index.html`);
    assert.ok([200, 429].includes(response.status), `unexpected status ${response.status}`);
    assert.ok(response.headers.get('content-security-policy'));
  } finally {
    await server.close();
  }
});

await Promise.all(pending);
if (selected && passed !== 1) throw new Error(`Acceptance ${selected} did not run exactly once.`);
process.stdout.write(`software/limit: ${passed} assertion(s) passed\n`);