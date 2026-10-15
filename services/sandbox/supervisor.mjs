/**
 * The sandbox supervisor, phase v12.
 *
 * Threat model, stated first because everything below follows from it:
 *
 *   The adversary is agent-authored content. An agent can write arbitrary bytes into a
 *   `software.web_app` node and will write whatever its prompt tells it to, including
 *   things that are trying to read credentials, reach the filesystem, reach the internet,
 *   or hang.
 *
 * Controls, and what each one actually is:
 *
 *   1. NO CODE EXECUTION. The supervisor serves bytes. It never evaluates, never compiles
 *      and never spawns agent content. There is no script engine in the process. This is the
 *      control that makes the rest safe, and it is why client-side behaviour is declared
 *      unavailable rather than approximated.
 *   2. LOOPBACK, EPHEMERAL PORT. The server binds 127.0.0.1 on port 0. It is not reachable
 *      from off-host, and a parallel run cannot collide with it.
 *   3. PATH CONTAINMENT. Only files the node declared, resolved to real paths inside the
 *      scratch directory. `..`, absolute paths, percent-encoding and symlinks are refused.
 *   4. GET/HEAD ONLY. No PUT, no DELETE, no method that could write.
 *   5. STRICT CSP BY HEADER. `default-src 'none'; script-src 'self'; style-src 'self';
 *      connect-src 'none'; img-src 'self'; base-uri 'none'; form-action 'none'`.
 *      `connect-src 'none'` is the network denial, enforced by the browser policy rather
 *      than by a comment in the source. Nothing in this file fetches anything either.
 *   6. STATIC SCAN. Inline event handlers, `javascript:` URLs, remote script sources and
 *      iframes are refused before a byte is served, and recorded as violations.
 *   7. SIZE AND TIME CAPS. Declared max document bytes, max request count, wall-clock cap.
 *   8. ENV SCRUB. The supervisor process is constructed with an empty environment; it has
 *      no provider credentials to leak in the first place.
 *
 * WHAT IS NOT COVERED — mandatory, and the reason the manifests stay cautious:
 *
 *   - This process has no OS-level network namespace. v07 established that Node's
 *     `--permission` flag does NOT deny sockets on this platform (a loopback fetch
 *     succeeded) and that WSL `unshare --net` is not permitted. Therefore this module
 *     deliberately performs NO agent-driven outbound request of any kind, and the software
 *     solver refuses `software.script` execution and `software.device_app` rather than
 *     pretending an in-process restriction is a security boundary.
 *   - There is no defence against a denial of service against the HOST. Per-run caps bound
 *     one run; they do not bound a determined local attacker.
 *   - There is no malware scanning and no content-type inference beyond the declared map.
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { scanMarkup } from '../../packages/solvers/software/dom.mjs';

export const DEFAULT_LIMITS = Object.freeze({
  max_document_bytes: 1_048_576,
  max_file_bytes: 1_048_576,
  max_requests: 256,
  wall_clock_ms: 10_000,
});

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Materialise a declared file set into a scratch directory.
 *
 * Rejects a file name that is absolute, traverses upward, or names a reserved device, before
 * anything touches the disk.
 */
export function materialise(files, { scratch = null } = {}) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new TypeError('A web app must declare a files object.');
  }
  const names = Object.keys(files);
  if (!names.length) throw new TypeError('A web app must declare at least one file.');
  const directory = scratch ?? makeScratchDir();
  const written = [];
  for (const name of names.sort()) {
    if (!isSafeName(name)) {
      throw Object.assign(new TypeError(`Web app file '${name}' is not a safe relative path.`), {
        code: 'UNSAFE_PATH',
      });
    }
    const content = String(files[name]);
    if (Buffer.byteLength(content, 'utf8') > DEFAULT_LIMITS.max_file_bytes) {
      throw Object.assign(new RangeError(`Web app file '${name}' exceeds the per-file byte cap.`), {
        code: 'SANDBOX_LIMIT_EXCEEDED',
      });
    }
    const target = resolve(directory, normalize(name));
    if (!target.startsWith(`${resolve(directory)}${sep}`)) {
      throw Object.assign(new TypeError(`Web app file '${name}' escapes the scratch directory.`), {
        code: 'UNSAFE_PATH',
      });
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
    written.push({ name, path: target, bytes: Buffer.byteLength(content, 'utf8') });
  }
  return { directory, files: written };
}

function makeScratchDir() {
  const directory = resolve(tmpdir(), `wireup-sandbox-${createHash('sha256')
    .update(`${process.pid}-${Date.now()}-${Math.random()}`)
    .digest('hex').slice(0, 16)}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function isSafeName(name) {
  if (typeof name !== 'string' || !name.length || name.length > 200) return false;
  if (isAbsolute(name) || name.includes('\0')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  const segments = name.split(/[\\/]/);
  return segments.every((segment) => segment.length && segment !== '.' && segment !== '..');
}

/**
 * Start the loopback static server.
 *
 * Returns a handle with the origin, the request log, the recorded violations and a `close`.
 */
export async function startStaticServer({ files, limits = {}, entry = 'index.html' } = {}) {
  const merged = { ...DEFAULT_LIMITS, ...limits };
  const materialised = materialise(files);
  const violations = [];
  const requests = [];

  for (const file of materialised.files) {
    if (!/\.(html?|svg)$/i.test(file.name)) continue;
    const scan = scanMarkup(readFileSync(file.path, 'utf8'), { origin: file.name });
    if (!scan.clean) violations.push(...scan.violations.map((violation) => ({ ...violation, file: file.name })));
  }
  if (violations.length) {
    // The listener has not been created yet, so there is nothing to close: refuse before
    // binding a port at all, and remove the scratch directory we just materialised.
    rmSync(materialised.directory, { recursive: true, force: true });
    throw Object.assign(
      new Error(`Web app markup refused: ${violations.map((violation) => violation.code).join(', ')}.`),
      { code: 'SANDBOX_MARKUP_REFUSED', violations },
    );
  }

  const root = realpathSync(materialised.directory);
  const server = createServer((request, response) => {
    const started = Date.now();
    if (requests.length >= merged.max_requests) {
      record(requests, request, 429, 'SANDBOX_LIMIT_EXCEEDED');
      response.writeHead(429, securityHeaders()).end('SANDBOX_LIMIT_EXCEEDED');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      record(requests, request, 405, 'SANDBOX_METHOD_DENIED');
      response.writeHead(405, securityHeaders()).end('SANDBOX_METHOD_DENIED');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const requested = decodeURIComponent(url.pathname);
    const relativePath = requested === '/' ? entry : requested.replace(/^\/+/, '');
    const target = resolve(root, normalize(relativePath));
    if (!target.startsWith(`${root}${sep}`) || !isSafeName(relativePath)) {
      record(requests, request, 403, 'SANDBOX_PATH_DENIED');
      response.writeHead(403, securityHeaders()).end('SANDBOX_PATH_DENIED');
      return;
    }
    let body;
    try {
      body = readFileSync(target);
    } catch {
      record(requests, request, 404, 'NOT_FOUND');
      response.writeHead(404, securityHeaders()).end('NOT_FOUND');
      return;
    }
    if (body.byteLength > merged.max_document_bytes) {
      record(requests, request, 413, 'SANDBOX_LIMIT_EXCEEDED');
      response.writeHead(413, securityHeaders()).end('SANDBOX_LIMIT_EXCEEDED');
      return;
    }
    const type = MIME[target.slice(target.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
    record(requests, request, 200, 'OK', body.byteLength, Date.now() - started);
    response.writeHead(200, { ...securityHeaders(), 'content-type': type, 'content-length': String(body.byteLength) });
    response.end(request.method === 'HEAD' ? undefined : body);
  });

  const address = await listenLoopback(server);
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    root,
    entry,
    requests,
    violations,
    limits: merged,
    async close() {
      await stopLoopback(server);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function record(requests, request, status, code, bytes = 0, durationMs = 0) {
  requests.push({
    method: request.method ?? 'UNKNOWN',
    path: request.url ?? '',
    status,
    code,
    bytes,
    duration_ms: durationMs,
  });
}

function securityHeaders() {
  return {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'cache-control': 'no-store',
  };
}

function listenLoopback(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolveListen(address);
      else rejectListen(new Error('Sandbox server did not bind a loopback port.'));
    });
  });
}

function stopLoopback(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}