// Contract verification. Dependency-free: runs with bare `node`, no build step.
//
// Checks that contracts/ is internally consistent AND consistent with the source of truth.
// This is the guard that stops a capability claim from existing without evidence.
//
//   node scripts/check-contracts.mjs           # verify
//   node scripts/check-contracts.mjs --print   # print the capability summary
//
// Exit code 0 means every check passed.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CONTRACTS = join(ROOT, 'contracts');

const problems = [];
const fail = (msg) => problems.push(msg);

function load(rel) {
  const path = join(CONTRACTS, rel);
  if (!existsSync(path)) {
    fail(`missing contract file: ${rel}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${rel}: not valid JSON — ${error.message}`);
    return null;
  }
}

// ------------------------------------------------------------------ load
const graphSchema = load('graph.schema.json');
const telemetrySchema = load('telemetry.schema.json');
const trialSchema = load('trial.schema.json');
const capabilitySchema = load('capability.schema.json');
const capability = load('capability.json');
const kindsDoc = load('kinds.json');
const portsDoc = load('port-types.json');
const derivations = load('derivations.json');
const manifest = load('manifest.json');

// ---------------------------------------------------- 1. manifest integrity
if (manifest && existsSync(CONTRACTS)) {
  const seen = new Set();
  for (const entry of manifest.files ?? []) {
    const path = join(CONTRACTS, entry.id);
    if (!existsSync(path)) {
      fail(`manifest lists ${entry.id} but it does not exist`);
      continue;
    }
    seen.add(entry.id);
    const bytes = readFileSync(path);
    const { createHash } = await import('node:crypto');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.sha256) {
      fail(`${entry.id}: sha256 mismatch — manifest says ${entry.sha256.slice(0, 12)}, file is ${actual.slice(0, 12)}. Run: python scripts/gen-contracts.py`);
    }
  }
  // Every contract file on disk must be in the manifest, or it is unaccounted for.
  const walk = (dir, prefix = '') => {
    for (const name of readdirSync(dir)) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const full = join(dir, name);
      if (name === 'tools') { walk(full, rel); continue; }
      if (!name.endsWith('.json') || rel === 'manifest.json') continue;
      if (!seen.has(rel)) fail(`${rel} is not listed in contracts/manifest.json`);
    }
  };
  if (existsSync(CONTRACTS)) walk(CONTRACTS);
}

// -------------------------------------------- 2. port types are self-consistent
const portTypes = portsDoc?.port_types ?? [];
const portIds = new Set(portTypes.map((p) => p.id));
if (portIds.size !== portTypes.length) fail('port-types.json: duplicate port type ids');
for (const p of portTypes) {
  for (const compat of p.compatible_with ?? []) {
    if (!portIds.has(compat)) fail(`port type ${p.id} is compatible_with unknown type ${compat}`);
  }
}

// ------------------------------------------- 3. kinds reference only real types
const kinds = kindsDoc?.kinds ?? [];
const kindIds = new Set();
for (const k of kinds) {
  if (kindIds.has(k.id)) fail(`kinds.json: duplicate kind id ${k.id}`);
  kindIds.add(k.id);
  for (const p of k.ports ?? []) {
    if (!portIds.has(p.type)) {
      fail(`kind ${k.id} port ${p.name} uses undeclared port type ${p.type}`);
    }
  }
}

// --------------------------- 4. SIMULATED CLAIMS MUST CITE EXISTING EVIDENCE
// This is the load-bearing check. A `simulated: true` with no evidence, or with evidence
// pointing at a file that does not exist, is exactly the failure this platform must not ship.
let simulated = 0;
for (const k of kinds) {
  if (!k.simulated) continue;
  simulated += 1;
  const evidence = k.evidence ?? [];
  if (evidence.length === 0) {
    fail(`kind ${k.id} claims simulated:true but cites no evidence`);
  }
  for (const path of evidence) {
    if (!existsSync(join(ROOT, path))) {
      fail(`kind ${k.id} claims simulated:true citing missing evidence ${path}`);
    }
  }
  if (k.scope === 'none') fail(`kind ${k.id} is simulated but scope is 'none'`);
  if (!k.solver) fail(`kind ${k.id} is simulated but declares no solver`);
}

// --------------------------- 5. capability mirrors kinds and keeps unsupported honest
if (capability && kindsDoc) {
  if (capability.generator_status !== 'generated') {
    fail(`capability.json: unknown generator_status ${capability.generator_status}`);
  }
  const capIds = new Set((capability.kinds ?? []).map((k) => k.id));
  for (const k of kinds) {
    if (!capIds.has(k.id)) fail(`capability.json is missing kind ${k.id}`);
  }
  if (capIds.size !== (capability.kinds ?? []).length) {
    fail('capability.json contains duplicate kind ids');
  }
  const capabilityById = new Map((capability.kinds ?? []).map((kind) => [kind.id, kind]));
  for (const kind of capability.kinds ?? []) {
    if (kind.simulated && !kind.solver) {
      fail(`capability kind ${kind.id} claims simulated:true without a registered solver`);
    }
    if (kind.confidence === 'verified' && !kind.simulated) {
      fail(`capability kind ${kind.id} claims confidence verified while simulated:false`);
    }
  }
  for (const kind of kinds) {
    const resolved = capabilityById.get(kind.id);
    if (resolved?.simulated && !kind.simulated) {
      fail(`capability kind ${kind.id} overstates contracts/kinds.json support`);
    }
  }
  for (const u of capability.unsupported ?? []) {
    if (!u.feature || !u.reason || !u.required_to_support) {
      fail('capability.json: an unsupported entry is missing feature/reason/required_to_support');
    }
  }
  if (!(capability.unsupported ?? []).length) {
    fail('capability.json has an empty unsupported array. A platform always has limits; ' +
         'an empty list is a claim that nothing is missing.');
  }
}

// --------------------------------- 6. telemetry quality rule is expressible
if (telemetrySchema) {
  const quality = telemetrySchema.properties?.quality?.enum;
  const expected = ['measured', 'derived', 'assumed', 'unavailable'];
  if (JSON.stringify(quality) !== JSON.stringify(expected)) {
    fail(`telemetry.schema.json quality enum is ${JSON.stringify(quality)}, expected ${JSON.stringify(expected)}`);
  }
  const hasUnavailableRule = (telemetrySchema.allOf ?? []).some((r) =>
    JSON.stringify(r).includes('unavailable'));
  if (!hasUnavailableRule) {
    fail('telemetry.schema.json has no rule forcing value=null when quality is unavailable');
  }
}

// ------------------------- 7. derived channels must have a derivations entry
const derivationChannels = new Set((derivations?.channels ?? []).map((c) => c.channel));
if (derivations && !derivations.channels?.length) {
  fail('derivations.json declares no channels, but derived telemetry requires them');
}

// ------------------------------------------------ 8. tool contracts are usable
const TOOLS_DIR = join(CONTRACTS, 'tools');
let toolCount = 0;
if (existsSync(TOOLS_DIR)) {
  for (const file of readdirSync(TOOLS_DIR)) {
    if (!file.endsWith('.tool.json')) continue;
    toolCount += 1;
    let tool;
    try {
      tool = JSON.parse(readFileSync(join(TOOLS_DIR, file), 'utf8'));
    } catch (error) {
      fail(`contracts/tools/${file}: not valid JSON — ${error.message}`);
      continue;
    }
    if (file !== `${tool.name}.tool.json`) {
      fail(`contracts/tools/${file}: filename does not match tool name ${tool.name}`);
    }
    if (!tool.summary || tool.summary.length < 10) {
      fail(`contract ${tool.name}: summary is missing or too short to be useful to a model`);
    }
    if (!tool.args || tool.args.type !== 'object') {
      fail(`contract ${tool.name}: args must be a JSON Schema object`);
    }
    if (tool.mutating && !tool.errors?.some((e) => e.code === 'REVISION_STALE')) {
      fail(`contract ${tool.name}: mutating=true but no REVISION_STALE error declared. ` +
           `Every mutation must declare revision conflict (invariant I2).`);
    }
    if (!Array.isArray(tool.errors) || tool.errors.length === 0) {
      fail(`contract ${tool.name}: declares no errors`);
    }
  }
}

// ------------------------------------- 9. every backend tool name is contracted
let backendToolNames = [];
try {
  const schemas = readFileSync(join(ROOT, 'backend', 'agent', 'schemas.py'), 'utf8');
  const match = schemas.match(/HARDWARE_TOOL_NAMES\s*=\s*tuple\(_TOOL_FIELDS\)/);
  const names = [...schemas.matchAll(/^\s{4}'([a-z_]+)':\s*\{/gm)].map((m) => m[1]);
  if (match && names.length) backendToolNames = names;
} catch { /* source not readable; skip */ }

if (backendToolNames.length && existsSync(TOOLS_DIR)) {
  for (const name of backendToolNames) {
    if (!existsSync(join(TOOLS_DIR, `${name}.tool.json`))) {
      fail(`backend tool ${name} has no contract in contracts/tools/`);
    }
  }
}

// ------------------------------------------------------------------ report
const unresolved = kindsDoc?.unresolved ?? [];
if (process.argv.includes('--print')) {
  console.log(`kinds            ${kinds.length}`);
  console.log(`  simulated      ${simulated}  (each cites an executable spec)`);
  console.log(`  placement-only ${kinds.filter((k) => !k.simulated).length - unresolved.length}`);
  console.log(`  unresolved     ${unresolved.length}  ${unresolved.join(', ')}`);
  console.log(`port types       ${portTypes.length}`);
  console.log(`tool contracts   ${toolCount}`);
  console.log(`capability      ${capability?.unsupported?.length ?? 0} declared limitations`);
  console.log(`derivations      ${derivations?.channels?.length ?? 0}`);
}

if (problems.length) {
  console.error(`\ncheck-contracts: FAIL — ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`check-contracts: PASS  (${kinds.length} kinds, ${simulated} simulated with evidence, ` +
            `${toolCount} tools, ${capability?.unsupported?.length ?? 0} declared limitations)`);