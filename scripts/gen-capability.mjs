import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solverRegistry } from '../packages/solvers/index.mjs';
import { selfTestRegistry } from '../packages/solvers/verify.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS = resolve(ROOT, 'contracts');
const CASES = resolve(ROOT, 'bench/cases');

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function walk(directory, files = []) {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function normalizeUnsupported(entry) {
  return {
    feature: String(entry.feature),
    kind: entry.kind ?? null,
    reason: String(entry.reason),
    required_to_support: String(entry.required_to_support ?? entry.requiredToSupport),
  };
}

function documentedUnsupported(markdown, kinds) {
  const output = [];
  const rows = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/gm;
  for (const match of markdown.matchAll(rows)) {
    const [, label, legacyType] = match;
    const kind = kinds.find((entry) => entry.legacy_type === legacyType
      || entry.id.endsWith(`.${legacyType}`));
    const hasVerifiedScope = Boolean(kind?.simulated);
    output.push({
      feature: `Documented component limitation: ${label.trim()} (${legacyType})`,
      kind: kind?.id ?? null,
      reason: hasVerifiedScope
        ? `The historical inventory lists '${legacyType}', but that limitation does not apply to its currently verified scopes; other combinations remain unverified.`
        : `The component availability document lists '${legacyType}' outside any explicitly verified board/peripheral scope.`,
      required_to_support: hasVerifiedScope
        ? `Additional verified runtime fixtures for '${legacyType}' on any board/peripheral combinations beyond its current tested scope.`
        : `Verified runtime fixtures for '${legacyType}' on the intended board and wiring.`,
    });
  }
  return output;
}

function passingCases(report) {
  const rows = report.rows ?? report.results ?? [];
  const grouped = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    if (!grouped.has(row.id)) grouped.set(row.id, []);
    grouped.get(row.id).push(row.status);
  }
  return new Set([...grouped]
    .filter(([, statuses]) => statuses.length > 0 && statuses.every((status) => status === 'pass'))
    .map(([id]) => id));
}

function exercisedCases(kinds, report) {
  const passing = passingCases(report);
  const exercised = new Map(kinds.map((kind) => [kind.id, []]));
  for (const caseFile of walk(CASES).filter((path) => path.endsWith('case.json'))) {
    const fixture = readJson(caseFile, null);
    if (!fixture || !passing.has(fixture.id)) continue;
    const projectPath = join(dirname(caseFile), 'project.json');
    if (!existsSync(projectPath)) continue;
    const project = readJson(projectPath, null);
    for (const node of project?.nodes ?? []) {
      if (exercised.has(node.kind)) exercised.get(node.kind).push(fixture.id);
    }
  }
  for (const cases of exercised.values()) cases.sort();
  return exercised;
}

function mergeUnsupported(entries) {
  const unique = new Map();
  for (const raw of entries) {
    const entry = normalizeUnsupported(raw);
    if (!entry.feature || !entry.reason || !entry.required_to_support) {
      throw new Error('Unsupported capability entries need feature, reason, and required_to_support.');
    }
    unique.set(JSON.stringify(entry), entry);
  }
  return [...unique.values()].sort((a, b) =>
    String(a.kind).localeCompare(String(b.kind)) || a.feature.localeCompare(b.feature));
}

export async function generateCapability({ root = ROOT, testReport } = {}) {
  const kindsDoc = readJson(resolve(root, 'contracts/kinds.json'), null);
  if (!Array.isArray(kindsDoc?.kinds)) throw new Error('contracts/kinds.json has no kinds array.');
  const report = testReport ?? readJson(resolve(root, 'bench/results/testreport.json'), {});
  const registry = solverRegistry;
  const verification = await selfTestRegistry(registry, { testReport: report });
  const solvers = registry.list();
  const owner = new Map();
  for (const solver of solvers) {
    for (const kindId of solver.manifest.kindIds) {
      if (owner.has(kindId)) throw new Error(`Duplicate solver claim for '${kindId}'.`);
      owner.set(kindId, solver.manifest.id);
    }
  }
  const cases = exercisedCases(kindsDoc.kinds, report);
  const capKinds = kindsDoc.kinds.map((kind) => {
    const solverId = owner.get(kind.id) ?? null;
    const result = solverId ? verification.get(solverId) : null;
    const simulated = Boolean(solverId && result?.self_test_passed);
    const confidence = result?.confidence ?? 'experimental';
    const unavailableConflict = solverId && solvers
      .find((solver) => solver.manifest.id === solverId)?.manifest.unavailable
      .some((entry) => entry.kind === kind.id);
    if (simulated && confidence === 'verified' && unavailableConflict) {
      throw new Error(`Capability contradiction: '${kind.id}' is verified but declared unavailable.`);
    }
    return {
      id: kind.id,
      exists: true,
      solver: solverId,
      simulated,
      confidence,
      exercised_by_cases: cases.get(kind.id) ?? [],
    };
  });

  const docsPath = resolve(root, 'docs/COMPONENT_SIMULATION_AVAILABILITY.md');
  const releasePath = resolve(root, 'RELEASE_STATUS.md');
  const staticEntries = readJson(resolve(root, 'bench/cases/meta/capability/unsupported.json'), { unsupported: [] }).unsupported;
  const docsEntries = documentedUnsupported(
    readFileSync(docsPath, 'utf8'),
    kindsDoc.kinds,
  );
  const manifests = solvers.map((solver) => solver.manifest);
  const registeredKinds = new Set(owner.keys());
  const unregisteredKinds = kindsDoc.kinds
    .filter((kind) => !registeredKinds.has(kind.id))
    .map((kind) => ({
      feature: `Simulation for ${kind.id}`,
      kind: kind.id,
      reason: 'No registered solver claims this kind.',
      required_to_support: `Register a solver with a passing prepare self-test and verified test coverage for '${kind.id}'.`,
    }));
  const limitations = mergeUnsupported([
    ...staticEntries,
    ...docsEntries,
    ...unregisteredKinds,
    ...manifests.flatMap((manifest) => [
      ...manifest.knownFailures.map((failure) => ({
        feature: failure.condition,
        kind: null,
        reason: failure.message,
        required_to_support: `Resolve and verify failure ${failure.code}.`,
      })),
      ...manifest.unavailable.map((entry) => ({
        feature: entry.feature,
        kind: entry.kind ?? null,
        reason: entry.reason,
        required_to_support: entry.requiredToSupport,
      })),
    ]),
    {
      feature: 'Release status source',
      kind: null,
      reason: `The generated capability is constrained by ${releasePath.slice(root.length + 1)}.`,
      required_to_support: 'Keep the release blockers represented by a solver failure or static unsupported entry.',
    },
  ]);

  const channels = new Set();
  const reportRows = report.rows ?? report.results ?? [];
  for (const row of reportRows) {
    if (row.status !== 'pass') continue;
    for (const channel of row.telemetry_channels ?? []) channels.add(channel);
  }
  const limitNames = {
    maxNodes: 'max_nodes',
    maxSimSeconds: 'max_sim_seconds',
    maxSubsteps: 'max_substeps',
    payloadBytes: 'max_payload_bytes',
    memoryBytes: 'max_memory_bytes',
  };
  const limits = {};
  for (const [manifestName, outputName] of Object.entries(limitNames)) {
    const values = manifests.map((manifest) => manifest.limits[manifestName])
      .filter((value) => Number.isSafeInteger(value) && value >= 0);
    if (values.length) limits[outputName] = Math.min(...values);
  }
  const contentForHash = {
    manifests: manifests.map((manifest) => canonical(manifest)),
    verification: [...verification].map(([id, value]) => [id, canonical(value)]),
    report: canonical(report),
    kinds: canonical(kindsDoc),
    staticUnsupported: canonical(staticEntries),
    componentAvailability: readFileSync(docsPath, 'utf8'),
    releaseStatus: readFileSync(releasePath, 'utf8'),
  };
  const digest = createHash('sha256').update(JSON.stringify(contentForHash)).digest('hex');
  return {
    environments: [],
    generated_at: `sha256:${digest}`,
    generator_status: 'generated',
    generator_version: 3,
    kinds: capKinds,
    limits,
    telemetry_channels: [...channels].sort(),
    unsupported: limitations,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await generateCapability();
  const destination = resolve(CONTRACTS, 'capability.json');
  const generated = `${JSON.stringify(output, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (!existsSync(destination) || readFileSync(destination, 'utf8') !== generated) {
      process.stderr.write('capability: OUT OF DATE\n');
      process.exitCode = 1;
    } else {
      process.stdout.write('capability: current\n');
    }
  } else {
    writeFileSync(destination, generated);
    process.stdout.write(`capability: generated ${output.kinds.length} kinds, ${output.unsupported.length} limitations\n`);
  }
}
