import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolBus, ToolBusError, createRegistry, createStubServices } from '../../../../packages/toolbus/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
const selected = process.argv[2];
if (selected !== undefined && !/^A[3-9]$/.test(selected)) {
  throw new TypeError(`Unknown acceptance selector '${selected}'.`);
}

const cases = new Map([
  ['A3', checkSecretScrubbing],
  ['A4', checkRegistryRejectsMissingHandlers],
  ['A5', checkUnavailableServices],
  ['A6', checkReviewAuthorization],
  ['A7', checkStaleMutation],
  ['A8', checkConcurrentMutations],
  ['A9', checkInvalidArguments],
]);

for (const [id, check] of cases) {
  if (selected && selected !== id) continue;
  await check();
  process.stdout.write(`PASS ${id}\n`);
}

function definition({ name = 'test.tool', mutating = false, requires_review = false, handler }) {
  return {
    contract: {
      name,
      args: {
        type: 'object',
        additionalProperties: true,
        ...(mutating ? { required: ['expected_revision'] } : {}),
      },
      result: { type: 'object' },
      mutating,
      requires_review,
      errors: [
        { code: 'INVALID_ARGUMENTS' },
        { code: 'REVISION_STALE' },
        { code: 'REVIEW_REQUIRED' },
        { code: 'NOT_IMPLEMENTED' },
      ],
    },
    handler,
  };
}

function busFor(definitions, overrides = {}) {
  const registry = { get: (name) => definitions.get(name) };
  return new ToolBus({
    registry,
    services: createStubServices({
      clock: { now: () => 100 },
      ...overrides,
    }),
  });
}

async function checkSecretScrubbing() {
  const token = 'runtime-token-test-value';
  const emitted = [];
  const bus = busFor(new Map([['test.tool', definition({
    handler: async (_args, context) => {
      context.emit({ type: 'tool.progress', detail: `token=${token}` });
      return {
        nested: [{ value: 'credential=' + token }, { runtime_token: token }],
        stack_trace: `at leaked (${token})`,
      };
    },
  })]]));
  const result = await bus.invoke('test.tool', {}, {
    projectId: 'project-a',
    runtimeToken: token,
    emit: (event) => emitted.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.stringify(emitted).includes(token), false);
  assert.ok(emitted.some((event) => event.type === 'tool.progress'));

  const errorEvents = [];
  const errorBus = busFor(new Map([['test.tool', definition({
    handler: async () => {
      throw new ToolBusError('INVALID_ARGUMENTS', `Rejected token ${token}\n    at leaked (${token})`, {
        details: { stack: `at leaked (${token})` },
      });
    },
  })]]));
  const failed = await errorBus.invoke('test.tool', {}, {
    projectId: 'project-a',
    runtimeToken: token,
    emit: (event) => errorEvents.push(event),
  });
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(failed).includes(token), false);
  assert.equal(JSON.stringify(errorEvents).includes(token), false);
  assert.equal(JSON.stringify(failed).includes('at leaked'), false);

  const sinkBus = busFor(new Map([['test.tool', definition({
    handler: async (_args, context) => {
      context.emit({ type: 'tool.progress' });
      return { applied: true };
    },
  })]]));
  const sinkFailure = await sinkBus.invoke('test.tool', {}, {
    projectId: 'project-a',
    runtimeToken: token,
    emit(event) {
      if (event.type === 'tool.progress') {
        throw new Error(`Sink rejected ${token}\n    at leaked (${token})`);
      }
    },
  });
  assert.equal(sinkFailure.ok, true);
  assert.equal(JSON.stringify(sinkFailure).includes(token), false);
  assert.equal(JSON.stringify(sinkFailure).includes('at leaked'), false);
}

async function checkRegistryRejectsMissingHandlers() {
  await assert.rejects(
    createRegistry({
      contractsDirectory: resolve(root, 'contracts', 'tools'),
      services: createStubServices(),
      handlers: {},
    }),
    /Tool registry mismatch; missing handlers:/,
  );
}

async function checkUnavailableServices() {
  const services = createStubServices();
  const unavailable = [
    [services.runtime, 'probe', 'v07'],
    [services.telemetry, 'read', 'v05'],
    [services.trials, 'run', 'v05'],
    [services.solvers, 'resolve', 'v06'],
  ];
  for (const [service, method, phase] of unavailable) {
    assert.throws(() => service[method](), (error) =>
      error instanceof ToolBusError
      && error.code === 'NOT_IMPLEMENTED'
      && error.message.includes(phase));
  }
}

async function checkReviewAuthorization() {
  let applied = 0;
  let authorized = true;
  const services = {
    review: {
      validate: async (projectId) => {
        assert.equal(projectId, 'project-a');
        return { valid: authorized };
      },
    },
  };
  const bus = busFor(new Map([['test.tool', definition({
    requires_review: true,
    handler: async () => {
      applied += 1;
      return { applied: true };
    },
  })]]), services);
  const base = {
    projectId: 'project-a',
    emit() {},
  };
  const review = {
    approvalId: 'approval-1',
    scope: { tools: ['test.tool'], kinds: ['part'], quantities: { part: 1 } },
  };
  const denied = await bus.invoke('test.tool', { kind: 'part', quantity: 1 }, base);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'REVIEW_REQUIRED');
  assert.equal(applied, 0);
  const wrongKind = await bus.invoke('test.tool', { kind: 'other', quantity: 1 }, {
    ...base,
    review,
  });
  assert.equal(wrongKind.ok, false);
  assert.equal(wrongKind.error.code, 'REVIEW_REQUIRED');
  const excessQuantity = await bus.invoke('test.tool', { kind: 'part', quantity: 2 }, {
    ...base,
    review,
  });
  assert.equal(excessQuantity.ok, false);
  assert.equal(excessQuantity.error.code, 'REVIEW_REQUIRED');
  authorized = false;
  const unauthorized = await bus.invoke('test.tool', { kind: 'part', quantity: 1 }, {
    ...base,
    review,
  });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.error.code, 'REVIEW_REQUIRED');
  assert.equal(applied, 0);
  authorized = true;
  const allowed = await bus.invoke('test.tool', { kind: 'part', quantity: 1 }, {
    ...base,
    review,
  });
  assert.equal(allowed.ok, true);
  assert.equal(applied, 1);
}

async function checkStaleMutation() {
  let revision = 4;
  let applied = 0;
  const store = { read: () => ({ revision }) };
  const bus = busFor(new Map([['test.tool', definition({
    mutating: true,
    handler: async () => {
      applied += 1;
      revision += 1;
      return { applied: true };
    },
  })]]));
  const result = await bus.invoke('test.tool', { expected_revision: 3 }, {
    projectId: 'project-a',
    store,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'REVISION_STALE');
  assert.equal(applied, 0);
  assert.equal(revision, 4);
}

async function checkConcurrentMutations() {
  let revision = 0;
  const store = { read: () => ({ revision }) };
  const bus = busFor(new Map([['test.tool', definition({
    mutating: true,
    handler: async () => {
      await Promise.resolve();
      revision += 1;
      return { applied: true };
    },
  })]]));
  const calls = Array.from({ length: 20 }, () => bus.invoke(
    'test.tool',
    { expected_revision: 0 },
    { projectId: 'project-a', store },
  ));
  const results = await Promise.all(calls);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.error.code === 'REVISION_STALE').length, 19);
  assert.equal(revision, 1);
}

async function checkInvalidArguments() {
  const registry = await createRegistry({
    contractsDirectory: resolve(root, 'contracts', 'tools'),
    services: createStubServices(),
  });
  const bus = new ToolBus({
    registry,
    services: createStubServices({ clock: { now: () => 100 } }),
  });
  const definitions = registry.list();
  assert.ok(definitions.length > 0);
  for (const { contract } of definitions) {
    const result = await bus.invoke(contract.name, null, { projectId: 'project-a' });
    assert.equal(result.ok, false, `${contract.name} should reject null arguments`);
    assert.ok(
      contract.errors.some((error) => error.code === result.error.code),
      `${contract.name} returned undeclared error '${result.error.code}'`,
    );
  }
}
