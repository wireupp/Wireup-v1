import { asToolError, scrubSecrets, ToolBusError } from './errors.mjs';
import { validateSchema } from './schema.mjs';

const DEFAULT_RATE = 60;
const WINDOW_MS = 60_000;

export class ToolBus {
  constructor({ registry, services, rateLimit = DEFAULT_RATE }) {
    if (!registry || !services) throw new TypeError('ToolBus requires a registry and services.');
    this.registry = registry;
    this.services = services;
    this.rateLimit = rateLimit;
    this.calls = new Map();
    this.projectLocks = new Map();
  }

  async invoke(name, args, context) {
    let contract;
    try {
      const definition = this.registry.get(name);
      contract = definition?.contract;
      return await this.#invoke(name, args, context, definition);
    } catch (error) {
      try {
        return scrubSecrets(failure(asToolError(error, contract)), context?.runtimeToken);
      } catch {
        return failure(new ToolBusError('TOOL_FAILED', 'Tool execution failed.'));
      }
    }
  }

  async #invoke(name, args, context, definition) {
    if (!definition) {
      return failure(new ToolBusError('UNKNOWN_TOOL', `Unknown tool '${name}'.`));
    }
    const { contract, handler } = definition;
    const issues = validateSchema(args, contract.args);
    if (issues.length) {
      return failure(new ToolBusError('INVALID_ARGUMENTS', issues.map((item) =>
        `${item.pointer || '/'} ${item.message}`).join('; '), { details: issues }));
    }
    const sessionId = context?.actor?.sessionId ?? context?.actor?.id ?? context?.projectId ?? 'anonymous';
    const rateError = this.#admit(sessionId);
    if (rateError) return failure(rateError);
    if (context?.deadlineMs && this.services.clock.now() >= context.deadlineMs) {
      return failure(new ToolBusError('DEADLINE_EXCEEDED', 'Tool deadline has expired.', { retryable: true }));
    }
    const lockKey = context?.projectId ?? sessionId;
    const previous = this.projectLocks.get(lockKey) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.projectLocks.set(lockKey, queued);
    let start = 0;
    const eventWarnings = [];
    try {
      await previous;
      start = this.services.clock.now();
      if (context?.deadlineMs && start >= context.deadlineMs) {
        throw new ToolBusError('DEADLINE_EXCEEDED', 'Tool deadline has expired.', { retryable: true });
      }
      const revision = context?.store?.read?.().revision;
      if (contract.mutating) {
        const expectedRevision = args?.expected_revision ?? context?.expectedRevision;
        if (!Number.isInteger(expectedRevision) || expectedRevision !== revision) {
          throw new ToolBusError(
            'REVISION_STALE',
            `Expected revision ${expectedRevision ?? 'not provided'}, but the project is at ${revision}. Re-read the project and retry.`,
          );
        }
      }
      const reviewError = await checkReview(contract, name, args, context, this.services);
      if (reviewError) throw reviewError;
      const startedEventError = emit(context, { type: 'tool.started', tool: name, revision });
      if (startedEventError) throw startedEventError;
      const handlerContext = context === undefined ? undefined : {
        ...context,
        emit(event) {
          const error = emit(context, event);
          if (error) eventWarnings.push(eventWarning(error, context));
        },
      };
      const raw = await handler(args, handlerContext, definition);
      const data = scrubSecrets(raw, context?.runtimeToken);
      const resultIssues = validateSchema(data, contract.result);
      if (resultIssues.some((issue) => issue.severity === 'error')) {
        throw new ToolBusError('RESULT_SCHEMA', `Tool '${name}' returned a value outside its result contract.`, {
          details: resultIssues,
        });
      }
      const nextRevision = context?.store?.read?.().revision ?? revision;
      const emitError = emit(context, {
        type: 'tool.finished',
        tool: name,
        ok: true,
        revision: nextRevision,
        duration_ms: Math.max(0, this.services.clock.now() - start),
      });
      return {
        ok: true,
        data,
        revision: nextRevision,
        ...((emitError || eventWarnings.length) ? {
          warnings: [...eventWarnings, ...(emitError ? [eventWarning(emitError, context)] : [])],
        } : {}),
      };
    } catch (error) {
      const mapped = asToolError(error, contract);
      const safeError = scrubSecrets({
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details === undefined ? {} : { details: mapped.details }),
        retryable: mapped.retryable,
      }, context?.runtimeToken);
      const emitError = emit(context, {
        type: 'tool.finished',
        tool: name,
        ok: false,
        error: safeError,
        duration_ms: Math.max(0, this.services.clock.now() - start),
      });
      return {
        ok: false,
        error: safeError,
        ...((emitError || eventWarnings.length) ? {
          warnings: [...eventWarnings, ...(emitError ? [eventWarning(emitError, context)] : [])],
        } : {}),
      };
    } finally {
      release();
      if (this.projectLocks.get(lockKey) === queued) this.projectLocks.delete(lockKey);
    }
  }

  async invokeBatch(items, context) {
    if (!Array.isArray(items)) {
      return [{ ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'Batch must be an array.', retryable: false } }];
    }
    const results = [];
    for (let index = 0; index < items.length; index += 1) {
      if (context?.deadlineMs && this.services.clock.now() >= context.deadlineMs) {
        results.push({
          ok: false,
          error: {
            code: 'DEADLINE_EXCEEDED',
            message: `Batch stopped before item ${index}; preceding items remain applied.`,
            retryable: true,
          },
        });
        for (let rest = index + 1; rest < items.length; rest += 1) {
          results.push({ ok: false, error: { code: 'NOT_RUN', message: 'Not run because the batch deadline expired.', retryable: false } });
        }
        break;
      }
      const item = items[index];
      results.push(await this.invoke(item?.name, item?.args, context));
    }
    return results;
  }

  #admit(sessionId) {
    const now = this.services.clock.now();
    const recent = (this.calls.get(sessionId) ?? []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= this.rateLimit) {
      this.calls.set(sessionId, recent);
      return new ToolBusError('RATE_LIMITED', `Session exceeded ${this.rateLimit} tool calls per minute.`, {
        retryable: true,
      });
    }
    recent.push(now);
    this.calls.set(sessionId, recent);
    return undefined;
  }
}

function eventWarning(error, context) {
  const mapped = asToolError(error);
  const safe = scrubSecrets({
    code: mapped.code ?? 'EVENT_SINK_FAILED',
    message: mapped.message ?? 'Tool event sink failed.',
    pointer: '/',
    severity: 'warning',
  }, context?.runtimeToken);
  return safe;
}

async function checkReview(contract, name, args, context, services) {
  if (!contract.requires_review) return undefined;
  const review = context?.review;
  if (!review || !review.approvalId || !review.scope
    || !Array.isArray(review.scope.tools) || !review.scope.tools.includes(name)
    || !Array.isArray(review.scope.kinds) || !review.scope.quantities
    || typeof review.scope.quantities !== 'object' || Array.isArray(review.scope.quantities)
    || review.scope.tools.some((tool) => typeof tool !== 'string')
    || review.scope.kinds.some((kind) => typeof kind !== 'string')
    || Object.values(review.scope.quantities).some((quantity) =>
      !Number.isSafeInteger(quantity) || quantity < 0)) {
    return new ToolBusError('REVIEW_REQUIRED', `A valid review covering '${name}' is required.`);
  }
  try {
    const authorization = await services.review.validate(context.projectId, review);
    if (!authorization?.valid) {
      return new ToolBusError('REVIEW_REQUIRED', authorization?.message
        ?? `Review '${review.approvalId}' is not valid for project '${context.projectId}'.`);
    }
  } catch (error) {
    return asToolError(error, contract);
  }
  const kinds = reviewedKinds(name, args, context);
  for (const kind of kinds) {
    if (!review.scope.kinds.some((allowed) => normalizeKind(allowed) === normalizeKind(kind))) {
      return new ToolBusError('REVIEW_REQUIRED', `Review '${review.approvalId}' does not cover kind '${kind}'.`);
    }
  }
  if (name === 'add_component' && kinds.length) {
    const kind = kinds[0];
    const quantity = args?.quantity ?? 1;
    const maximum = Math.max(0, ...Object.entries(review.scope.quantities)
      .filter(([allowed]) => normalizeKind(allowed) === normalizeKind(kind))
      .map(([, value]) => value));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) {
      return new ToolBusError('REVIEW_REQUIRED', `Review '${review.approvalId}' does not cover quantity ${quantity} of '${kind}'.`);
    }
  }
  if (['remove_component', 'modify_component'].includes(name) && kinds.length === 0) {
    return new ToolBusError('REVIEW_REQUIRED', `Review '${review.approvalId}' cannot verify the target component kind.`);
  }
  return undefined;
}

function reviewedKinds(name, args, context) {
  const explicit = args?.kind ?? args?.type ?? args?.node?.kind ?? args?.node?.type;
  if (typeof explicit === 'string' && explicit) return [explicit];
  if (!['remove_component', 'modify_component', 'connect_wire', 'wire_circuit'].includes(name)) return [];

  const graph = context?.store?.read?.();
  if (!graph || typeof graph !== 'object') return [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const components = Array.isArray(graph.components) ? graph.components : [];
  const legacyNodes = graph.metadata?.legacy_electronics?.nodes ?? {};
  const kinds = new Set();
  const addTargetKind = (targetId) => {
    for (const node of nodes) {
      const legacyId = legacyNodes[node.id]?.legacy_id;
      if (node.id !== targetId && legacyId !== targetId) continue;
      const kind = legacyNodes[node.id]?.legacy_type ?? node.kind;
      if (typeof kind === 'string') kinds.add(kind);
    }
    for (const component of components) {
      if (component.id === targetId && typeof component.type === 'string') kinds.add(component.type);
    }
  };

  if (name === 'remove_component' || name === 'modify_component') {
    addTargetKind(args?.id ?? args?.node_id);
  } else {
    const wires = name === 'wire_circuit' ? args?.batch ?? [] : [args];
    for (const wire of wires) {
      for (const side of ['from', 'to']) {
        const endpoint = wire?.[side];
        if (endpoint && typeof endpoint === 'object') addTargetKind(endpoint.component ?? endpoint.node);
        else if (typeof endpoint === 'string') {
          const separator = endpoint.lastIndexOf('.');
          if (separator > 0) addTargetKind(endpoint.slice(0, separator));
        }
      }
    }
  }
  return [...kinds];
}

function normalizeKind(kind) {
  return kind.startsWith('wokwi-') ? kind.slice('wokwi-'.length) : kind;
}

function emit(context, event) {
  if (typeof context?.emit !== 'function') return undefined;
  try {
    context.emit(scrubSecrets(event, context.runtimeToken));
    return undefined;
  } catch (error) {
    return new ToolBusError('EVENT_SINK_FAILED', error?.message ?? 'Tool event sink failed.');
  }
}

function failure(error) {
  return {
    ok: false,
    error: {
      code: error.code ?? 'TOOL_FAILED',
      message: error.message ?? 'Tool execution failed.',
      ...(error.details === undefined ? {} : { details: error.details }),
      retryable: Boolean(error.retryable),
    },
  };
}
