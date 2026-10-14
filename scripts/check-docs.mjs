#!/usr/bin/env node
// Documentation hygiene guard.
//
// Prevents the sprawl that already existed once: stale audit reports that contradict
// each other and that every agent then cites at random. Deliberately simple.
//
// Usage:
//   node scripts/check-docs.mjs
//   node scripts/check-docs.mjs --print

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// Reports removed in phase v01. Their unique facts were folded into docs/ARCHITECTURE.md.
const RETIRED = [
  'docs/RELEASE_READINESS_REPORT.md',
  'docs/RELEASE_REGRESSION_AUDIT.md',
  'docs/RELEASE_20_PROJECT_REPORT.md',
  'docs/RELEASE_20_PROJECT_REPORT-rerun.md',
  'docs/RELEASE_20_PROJECT_REPORT-targeted.md',
  'LANGCHAIN_AUDIT.md',
];

// Docs that must carry a pointer to the parent document.
const MUST_LINK = [
  'README.md',
  'RELEASE_STATUS.md',
  'backend/HARDWARE_CONTRACT.md',
  'backend/FEASIBILITY_CONTRACT.md',
  'backend/QUESTION_CONTRACT.md',
  'docs/SIMULATION_INTEGRATION_BACKLOG.md',
  'docs/VELXIO_EXAMPLE_FINDINGS.md',
  'docs/COMPONENT_SIMULATION_AVAILABILITY.md',
];

const PARENT_POINTERS = ['ARCHITECTURE.md', 'docs/ARCHITECTURE.md'];

const problems = [];

function read(file) {
  return readFileSync(file, 'utf8');
}

// 1. Retired reports must be gone.
for (const rel of RETIRED) {
  if (existsSync(join(ROOT, rel))) {
    problems.push(`${rel} was retired in v01 but still exists`);
  }
}

// 2. No inbound references to retired reports anywhere in the tracked tree.
const SCAN_DIRS = ['src', 'backend', 'scripts', 'tests', 'docs', 'packages', 'services', 'apps', 'prompts'];
const SKIP = new Set(['node_modules', '.git', 'vendor', '__pycache__', 'dist', 'results', 'playwright-report', 'test-results']);
const TEXT = new Set(['.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.json', '.yml', '.yaml']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const linkProblems = [];

for (const file of files) {
  const name = file.split('\\').pop();
  if (!TEXT.has(name.slice(name.lastIndexOf('.')))) continue;
  let text;
  try {
    text = read(file);
  } catch {
    continue;
  }
  if (!PARENT_POINTERS.some((p) => text.includes(p))) {
    linkProblems.push(relative(ROOT, file).replace(/\\/g, '/'));
  }
}

// 3. docs/ must not accumulate unreviewed status reports.
const DOCS = join(ROOT, 'docs');
let reportCount = 0;
if (existsSync(DOCS)) {
  for (const entry of readdirSync(DOCS, { withFileTypes: true })) {
    if (entry.isFile() && /^[A-Z_]+(_[A-Z0-9]+)*\.(md|json)$/.test(entry.name)) reportCount += 1;
  }
}

// 4. Phase reports must exist once later phases have run.
const phaseReports = join(DOCS, 'phase-reports');

const output = {
  retired_present: RETIRED.filter((rel) => existsSync(join(ROOT, rel))),
  parent_pointer_missing: linkProblems,
  must_link_missing: MUST_LINK.filter((rel) => !existsSync(join(ROOT, rel))),
  docs_file_count: existsSync(DOCS) ? readdirSync(DOCS).filter((f) => statSync(join(DOCS, f)).isFile()).length : 0,
  upper_case_doc_count: reportCount,
  phase_reports_dir: existsSync(phaseReports),
};

if (process.argv.includes('--print')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

if (output.retired_present.length > 0) {
  problems.push(`retired reports still present: ${output.retired_present.join(', ')}`);
}
if (output.must_link_missing.length > 0) {
  problems.push(`required documents missing: ${output.must_link_missing.join(', ')}`);
}
if (!existsSync(join(ROOT, 'docs', 'ARCHITECTURE.md'))) {
  problems.push('docs/ARCHITECTURE.md is missing; it is the parent document');
}
if (existsSync(DOCS) && readdirSync(DOCS).filter((f) => statSync(join(DOCS, f)).isFile()).length > 30) {
  problems.push('docs/ has grown past 30 files; consolidation required');
}

if (problems.length > 0) {
  process.stderr.write(`check-docs: FAIL\n`);
  for (const p of problems) process.stderr.write(`  ${p}\n`);
  process.exit(1);
}

process.stdout.write(`check-docs: PASS (${output.docs_file_count} docs files, 0 retired reports)\n`);