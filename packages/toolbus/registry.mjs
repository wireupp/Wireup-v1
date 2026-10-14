import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from './schema.mjs';
import { createHandlers } from './tools/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACTS = resolve(ROOT, 'contracts/tools');

export async function createRegistry({ contractsDirectory = CONTRACTS, services, handlers: suppliedHandlers } = {}) {
  if (!services) throw new TypeError('createRegistry requires injected ToolServices.');
  const files = (await readdir(contractsDirectory)).filter((file) => file.endsWith('.tool.json')).sort();
  const contracts = [];
  for (const file of files) {
    const contract = JSON.parse(await readFile(resolve(contractsDirectory, file), 'utf8'));
    if (!contract.name || !contract.args || !contract.result) {
      throw new Error(`Tool contract '${file}' is missing name, args, or result.`);
    }
    contracts.push(contract);
  }
  const contractNames = new Set(contracts.map((contract) => contract.name));
  if (contractNames.size !== contracts.length) throw new Error('Duplicate tool contract name.');
  const handlers = suppliedHandlers ?? createHandlers(services, contractNames);
  const missing = [...contractNames].filter((name) => typeof handlers[name] !== 'function');
  const extra = Object.keys(handlers).filter((name) => !contractNames.has(name));
  if (missing.length || extra.length) {
    throw new Error(`Tool registry mismatch; missing handlers: ${missing.join(', ') || '(none)'}; ` +
      `handlers without contracts: ${extra.join(', ') || '(none)'}.`);
  }
  const definitions = new Map(contracts.map((contract) => [
    contract.name,
    Object.freeze({ contract, handler: handlers[contract.name] }),
  ]));
  return Object.freeze({
    get(name) {
      return definitions.get(name);
    },
    list({ domain, mutating, requiresRuntime } = {}) {
      return [...definitions.values()].filter(({ contract }) =>
        (domain === undefined || contract.domain === domain) &&
        (mutating === undefined || Boolean(contract.mutating) === mutating) &&
        (requiresRuntime === undefined || Boolean(contract.requires_runtime) === requiresRuntime));
    },
    validateArgs(name, args) {
      const definition = definitions.get(name);
      return definition ? validateSchema(args, definition.contract.args) : [{
        code: 'UNKNOWN_TOOL', pointer: '/name', message: `unknown tool '${name}'`, severity: 'error',
      }];
    },
  });
}
