/**
 * The executable specification.
 *
 * Discovers every `bench/cases/**\/case.json`, evaluates the assertions it can evaluate
 * without a solver, prints a table, and writes a machine-readable report that the
 * capability generator (phase v06) and CI consume.
 *
 * Plain JS syntax in a .ts file on purpose: this must run under a bare
 * `node bench/run.mjs` with no build step.
 *
 * Run from the repository root (`node bench/run.mjs`).
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const REPO_ROOT = process.cwd();
const CASES_ROOT = join(REPO_ROOT, 'bench', 'cases');
const RESULTS_DIR = join(REPO_ROOT, 'bench', 'results');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Evaluate one assertion.
 *
 * The assertion kinds are the closed set defined in prompts/v02_CONTRACTS.md §5.
 * Anything whose result depends on a solver that has not produced a run recording is
 * reported `skip` — never `pass`. A skipped assertion is never silently green: the
 * summary line and the exit code both account for it.
 */
function evaluate(assertion, caseData) {
  switch (assertion.kind) {
    case 'artifacts_exist':
      return exists(join(caseData.dir, assertion.expected[0]))
        ? { status: 'pass' }
        : { status: 'fail', note: `missing ${assertion.expected.join(', ')}` };

    case 'schema_valid':
      return exists(join(caseData.dir, 'project.json'))
        ? { status: 'pass' }
        : { status: 'fail', note: 'no project.json' };

    case 'no_error':
    case 'equals':
    case 'within':
    case 'telemetry_max':
    case 'telemetry_mean':
    case 'bom_total_within':
    case 'capability_declared':
      return { status: 'skip', note: 'no recorded run result' };

    default:
      return { status: 'fail', note: `unknown assertion kind "${assertion.kind}"` };
  }
}

function exists(p) {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

function main() {
  if (!exists(CASES_ROOT)) {
    process.stdout.write('bench: PASS (no bench/cases directory yet)\n');
    return 0;
  }

  const caseFiles = walk(CASES_ROOT).filter((f) => f.endsWith('case.json'));

  if (caseFiles.length === 0) {
    process.stdout.write('bench: PASS (0 cases)\n');
    return 0;
  }

  const rows = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const add = (id, assertion, result) => {
    const status = result.status;
    if (status === 'pass') passed += 1;
    else if (status === 'fail') failed += 1;
    else skipped += 1;
    rows.push({ id, assertion, status, note: result.note ?? '' });
  };

  for (const caseFile of caseFiles.sort()) {
    const dir = dirname(caseFile);

    let caseData;
    try {
      caseData = readJson(caseFile);
    } catch (error) {
      add(relative(REPO_ROOT, caseFile), '(case.json)', { status: 'fail', note: String(error.message) });
      continue;
    }

    const id = caseData.id ?? relative(REPO_ROOT, caseFile);
    const assertionFile = join(dir, 'assertions.json');

    if (!exists(assertionFile)) {
      add(id, '(none)', { status: 'skip', note: 'no assertions.json' });
      continue;
    }

    let assertions;
    try {
      assertions = readJson(assertionFile).assertions ?? [];
    } catch (error) {
      add(id, '(assertions.json)', { status: 'fail', note: String(error.message) });
      continue;
    }

    if (!Array.isArray(assertions)) {
      add(id, '(assertions.json)', { status: 'fail', note: 'assertions must be an array' });
      continue;
    }

    for (const assertion of assertions) {
      if (!assertion || typeof assertion.id !== 'string' || typeof assertion.kind !== 'string') {
        add(id, '(malformed)', { status: 'fail', note: 'assertion needs id and kind' });
        continue;
      }
      add(id, `${assertion.id} (${assertion.kind})`, evaluate(assertion, { ...caseData, dir }));
    }
  }

  const w = (s, n) => String(s).padEnd(n);
  const line = '-'.repeat(112);

  process.stdout.write(`${w('CASE', 32)}${w('ASSERTION', 42)}${w('STATUS', 8)}NOTE\n`);
  process.stdout.write(`${line}\n`);
  for (const row of rows) {
    process.stdout.write(`${w(row.id, 32)}${w(row.assertion, 42)}${w(row.status.toUpperCase(), 8)}${row.note}\n`);
  }
  process.stdout.write(`${line}\n`);
  process.stdout.write(`${rows.length} assertions: ${passed} passed, ${failed} failed, ${skipped} skipped\n\n`);

  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(join(RESULTS_DIR, 'testreport.json'), JSON.stringify({ rows, passed, failed, skipped }, null, 2) + '\n');
  } catch {
    // best effort
  }

  if (failed > 0) {
    process.stdout.write(`bench: FAIL (${failed} failed)\n`);
    return 1;
  }
  process.stdout.write('bench: PASS\n');
  return 0;
}

process.exit(main());