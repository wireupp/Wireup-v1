export class ToolBusError extends Error {
  constructor(code, message, { details, retryable = false } = {}) {
    super(message);
    this.name = 'ToolBusError';
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export function notImplemented(phase, feature) {
  throw new ToolBusError(
    'NOT_IMPLEMENTED',
    `${feature} is not implemented; it is owned by phase ${phase}.`,
    { details: { phase, feature } },
  );
}

export function asToolError(error, contract) {
  if (error instanceof ToolBusError) {
    return new ToolBusError(error.code, safeMessage(error), {
      details: error.details,
      retryable: error.retryable,
    });
  }
  if (error?.code && contract?.errors?.some((entry) => entry.code === error.code)) {
    return new ToolBusError(error.code, safeMessage(error), {
      details: error.details,
      retryable: Boolean(error.retryable),
    });
  }
  const status = error?.status ?? error?.status_code;
  const code = status === 409 ? 'REVISION_STALE'
    : status === 503 ? 'SOLVER_UNAVAILABLE'
      : status === 429 ? 'RATE_LIMITED'
        : 'INVALID_ARGUMENTS';
  const declared = contract?.errors?.some((entry) => entry.code === code);
  return new ToolBusError(
    declared ? code : 'TOOL_FAILED',
    safeMessage(error),
    { details: declared ? error?.details : undefined, retryable: status === 429 || status === 503 },
  );
}

function safeMessage(error) {
  const message = typeof error?.message === 'string' ? error.message : 'Tool execution failed.';
  return message
    .replace(/\b(?:Traceback \(most recent call last\):|File "[^"]+", line \d+).*/s, 'Tool execution failed.')
    .replace(/\r?\n\s*at\s+[\s\S]*$/m, '');
}

export function scrubSecrets(value, token) {
  if (Array.isArray(value)) return value.map((item) => scrubSecrets(item, token));
  if (value && typeof value === 'object') {
    const output = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (/token|secret|credential|api.?key|stack/i.test(key)) continue;
      output[key] = scrubSecrets(item, token);
    }
    return output;
  }
  if (typeof value === 'string') {
    return (token ? value.split(token).join('[REDACTED]') : value)
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '******');
  }
  return value;
}
