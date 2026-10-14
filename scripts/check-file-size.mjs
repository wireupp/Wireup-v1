#!/usr/bin/env node
// God-file guard. Fails when a tracked source file exceeds the limit, except files
// explicitly baselined in bench/known-oversize.txt (which may not grow).
//
// Usage:
//   node scripts/check-file-size.mjs
//   node scripts/check-file-size.mjs --print

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const LIMIT = 800;
const ROOT = process.cwd();
const BASELINE = join(ROOT, 'bench', 'known-oversize.txt');
const SCAN_DIRS = ['src', 'backend', 'packages', 'services', 'apps', 'scripts', 'tests'];
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'dist', 'build', '.git', 'vendor', 'results', 'playwright-report', 'test-results']);
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && EXTS.has(extname(entry.name))) out.push(full);
  }
  return out;
}

function loadBaseline() {
  const map = new Map();
  if (!existsSync(BASELINE)) return map;
  for (const line of readFileSync(BASELINE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.lastIndexOf(':');
    if (at < 0) continue;
    map.set(trimmed.slice(0, at).replace(/\\/g, '/'), Number(trimmed.slice(at + 1)) || 0);
  }
  return map;
}

function lineCount(file) {
  const text = readFileSync(file, 'utf8');
  if (text.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return text.endsWith('\n') ? n - 1 : n;
}

const baseline = loadBaseline();
const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

const violations = [];
const oversized = [];

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const count = lineCount(file);
  if (count <= LIMIT) continue;
  oversized.push({ rel, count });
  const allowed = baseline.get(rel);
  if (allowed === undefined) {
    violations.push(`${rel}: ${count} lines exceeds the ${LIMIT}-line limit and is not in bench/known-oversize.txt`);
  } else if (count > allowed) {
    violations.push(`${rel}: grew from ${allowed} to ${count} lines. Baseline files may not grow — extract instead.`);
  }
}

if (process.argv.includes('--print')) {
  process.stdout.write(`${oversized.length} file(s) above ${LIMIT} lines:\n`);
  for (const f of oversized.sort((a, b) => b.count - a.count)) {
    const mark = baseline.has(f.rel) ? ' (baselined)' : ' (VIOLATION)';
    process.stdout.write(`  ${String(f.count).padStart(6)}  ${f.rel}${mark}\n`);
  }
}

if (violations.length > 0) {
  process.stderr.write(`check-file-size: ${violations.length} violation(s)\n`);
  for (const v of violations) process.stderr.write(`  ${v}\n`);
  process.exit(1);
}

process.stdout.write(`check-file-size: PASS (${files.length} files scanned, ${oversized.length} oversized and baselined)\n`);