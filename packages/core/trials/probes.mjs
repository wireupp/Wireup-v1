const MAX_EXPRESSION_LENGTH = 4096;
const MAX_TOKENS = 512;
const MAX_DEPTH = 64;
const MAX_PROBES = 256;
const QUALITY = new Set(['measured', 'derived', 'assumed', 'unavailable']);
const FORBIDDEN_IDENTIFIERS = new Set([
  '__proto__', 'prototype', 'constructor', 'this', 'globalThis', 'window', 'global',
]);
const OPERATORS = ['===', '!==', '>=', '<=', '==', '!=', '&&', '||', '>', '<', '+', '-', '*', '/', '!'];

export async function runProbes(probes, session) {
  if (!Array.isArray(probes)) throw new TypeError('Probes must be an array.');
  if (probes.length > MAX_PROBES) throw new RangeError(`A probe batch cannot exceed ${MAX_PROBES} probes.`);
  if (!session || typeof session.read !== 'function') {
    throw new TypeError('Probe session must provide read(target, { signal }).');
  }

  return Promise.all(probes.map((probe) => runProbe(probe, session)));
}

async function runProbe(probe, session) {
  const id = typeof probe?.id === 'string' ? probe.id : '';
  const startedAt = Date.now();
  const timeoutMs = probe?.timeout_ms;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    return failedResult(id, startedAt, 'INVALID_TIMEOUT', 'Probe timeout_ms must be between 1 and 60000.');
  }
  if (typeof probe.expression !== 'string' || !isValidTarget(probe.target)) {
    return failedResult(id, startedAt, 'INVALID_PROBE', 'Probe target and expression are required.');
  }
  if (probe.expect !== undefined && !isValidExpectation(probe.expect)) {
    return failedResult(id, startedAt, 'INVALID_EXPECTATION', 'Probe expectation must use a supported operator and scalar value.');
  }

  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(probeError('PROBE_TIMEOUT', `Probe '${id}' timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
    });
    const reading = Promise.resolve(session.read(probe.target, { signal: controller.signal }));
    const view = await Promise.race([reading, timeout]);
    const { state, unit = null, quality, runtimeToken } = validateView(view);
    const value = evaluate(probe.expression, state);
    if (runtimeToken && ((typeof value === 'string' && value.includes(runtimeToken))
        || (typeof unit === 'string' && unit.includes(runtimeToken)))) {
      throw probeError('TOKEN_FORBIDDEN', 'Probe results cannot contain a runtime token.');
    }
    if (probe.expect && !matchesExpectation(value, probe.expect)) {
      return {
        id,
        ok: false,
        value,
        unit,
        quality,
        error: { code: 'EXPECTATION_FAILED', message: `Probe '${id}' did not meet its expectation.` },
        at: new Date(startedAt).toISOString(),
      };
    }
    return { id, ok: true, value, unit, quality, at: new Date(startedAt).toISOString() };
  } catch (error) {
    const safe = error?.probeSafe === true;
    const code = safe ? error.code : 'PROBE_FAILED';
    const message = safe ? error.message : `Probe '${id}' failed.`;
    return failedResult(id, startedAt, code, message);
  } finally {
    clearTimeout(timer);
  }
}

// Target keys are a CLOSED set of plain strings. Phase v12 added `url_path`, `op` and
// `selector` for web/script targets; they name a declared DOM operation, never an
// expression over a live document, so the evaluator is unchanged.
const TARGET_KEYS = ['node', 'port', 'app', 'url_path', 'op', 'selector', 'symbol', 'attribute'];

function isValidTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return false;
  const prototype = Object.getPrototypeOf(target);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(target);
  if (!keys.length) return false;
  const descriptors = Object.getOwnPropertyDescriptors(target);
  return keys.every((key) => {
    const descriptor = descriptors[key];
    return TARGET_KEYS.includes(key)
      && !descriptor.get && !descriptor.set
      && typeof descriptor.value === 'string'
      && descriptor.value.length > 0
      && descriptor.value.length <= 128;
  });
}

function isValidExpectation(expectation) {
  if (!expectation || typeof expectation !== 'object' || Array.isArray(expectation)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(expectation);
  const op = descriptors.op?.value;
  const value = descriptors.value?.value;
  return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(op)
    && !descriptors.op?.get && !descriptors.op?.set
    && !descriptors.value?.get && !descriptors.value?.set
    && (value === null || ['string', 'boolean'].includes(typeof value)
      || (typeof value === 'number' && Number.isFinite(value)));
}

function validateView(view) {
  if (!view || typeof view !== 'object' || Array.isArray(view)
      || !view.state || typeof view.state !== 'object' || Array.isArray(view.state)) {
    throw probeError('PROBE_UNAVAILABLE', 'Probe session did not provide a scoped state view.');
  }
  const prototype = Object.getPrototypeOf(view.state);
  if (prototype !== Object.prototype && prototype !== null) {
    throw probeError('PROBE_UNAVAILABLE', 'Probe state must be a plain, scoped object.');
  }
  if (!QUALITY.has(view.quality)) {
    throw probeError('PROBE_UNAVAILABLE', 'Probe session did not provide a valid quality tag.');
  }
  if (view.quality === 'unavailable') {
    throw probeError('PROBE_UNAVAILABLE', 'The requested probe state is unavailable.');
  }
  if (view.unit !== undefined && view.unit !== null
      && (typeof view.unit !== 'string' || view.unit.length > 128)) {
    throw probeError('PROBE_UNAVAILABLE', 'Probe session returned an invalid unit.');
  }
  if (view.runtimeToken !== undefined && typeof view.runtimeToken !== 'string') {
    throw probeError('PROBE_UNAVAILABLE', 'Probe session returned invalid token metadata.');
  }
  const state = Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(view.state))) {
    if (descriptor.get || descriptor.set) {
      throw probeError('PROBE_UNAVAILABLE', 'Probe state cannot contain accessor properties.');
    }
    if (/token|secret|credential|api.?key/i.test(key)) continue;
    const value = descriptor.value;
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw probeError('PROBE_UNAVAILABLE', `Probe state '${key}' is not finite.`);
    }
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) state[key] = value;
  }
  return { state, unit: view.unit ?? null, quality: view.quality, runtimeToken: view.runtimeToken };
}

function failedResult(id, timestamp, code, message) {
  return {
    id,
    ok: false,
    value: null,
    unit: null,
    quality: 'unavailable',
    error: { code, message },
    at: new Date(timestamp).toISOString(),
  };
}

function matchesExpectation(value, expectation) {
  const { op, value: expected } = expectation;
  switch (op) {
    case 'eq': return value === expected;
    case 'ne': return value !== expected;
    case 'gt': return typeof value === 'number' && typeof expected === 'number' && value > expected;
    case 'gte': return typeof value === 'number' && typeof expected === 'number' && value >= expected;
    case 'lt': return typeof value === 'number' && typeof expected === 'number' && value < expected;
    case 'lte': return typeof value === 'number' && typeof expected === 'number' && value <= expected;
    default: throw probeError('INVALID_EXPECTATION', `Unsupported probe expectation operator '${op}'.`);
  }
}

function evaluate(expression, state) {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw probeError('EXPRESSION_TOO_LARGE', `Probe expressions cannot exceed ${MAX_EXPRESSION_LENGTH} characters.`);
  }
  const parser = new Parser(expression, state);
  const value = parser.parse();
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  throw probeError('INVALID_RESULT', 'Probe expressions must return a scalar value.');
}

class Parser {
  constructor(expression, state) {
    this.tokens = tokenize(expression);
    this.state = state;
    this.index = 0;
    this.depth = 0;
  }

  parse() {
    const result = this.parseOr();
    if (this.peek().type !== 'eof') this.syntax('Unexpected token.');
    return result;
  }

  parseOr() {
    let value = this.parseAnd();
    while (this.consume('||')) {
      const right = this.parseAnd();
      if (typeof value !== 'boolean' || typeof right !== 'boolean') this.typeError('|| requires boolean operands.');
      value = value || right;
    }
    return value;
  }

  parseAnd() {
    let value = this.parseComparison();
    while (this.consume('&&')) {
      const right = this.parseComparison();
      if (typeof value !== 'boolean' || typeof right !== 'boolean') this.typeError('&& requires boolean operands.');
      value = value && right;
    }
    return value;
  }

  parseComparison() {
    let value = this.parseAdditive();
    while (['===', '!==', '==', '!=', '>', '>=', '<', '<='].includes(this.peek().value)) {
      const op = this.advance().value;
      const right = this.parseAdditive();
      if (op === '===' || op === '==') value = value === right;
      else if (op === '!==' || op === '!=') value = value !== right;
      else {
        if (typeof value !== typeof right || !['number', 'string'].includes(typeof value)) {
          this.typeError(`${op} requires two numbers or two strings.`);
        }
        value = op === '>' ? value > right : op === '>=' ? value >= right : op === '<' ? value < right : value <= right;
      }
    }
    return value;
  }

  parseAdditive() {
    let value = this.parseMultiplicative();
    while (this.peek().value === '+' || this.peek().value === '-') {
      const op = this.advance().value;
      const right = this.parseMultiplicative();
      if (typeof value !== 'number' || typeof right !== 'number') this.typeError(`${op} requires numeric operands.`);
      value = op === '+' ? value + right : value - right;
      this.assertFinite(value);
    }
    return value;
  }

  parseMultiplicative() {
    let value = this.parseUnary();
    while (this.peek().value === '*' || this.peek().value === '/') {
      const op = this.advance().value;
      const right = this.parseUnary();
      if (typeof value !== 'number' || typeof right !== 'number') this.typeError(`${op} requires numeric operands.`);
      if (op === '/' && right === 0) this.typeError('Division by zero is not allowed.');
      value = op === '*' ? value * right : value / right;
      this.assertFinite(value);
    }
    return value;
  }

  parseUnary() {
    if (this.consume('!')) {
      const value = this.parseUnary();
      if (typeof value !== 'boolean') this.typeError('! requires a boolean operand.');
      return !value;
    }
    if (this.consume('-')) {
      const value = this.parseUnary();
      if (typeof value !== 'number') this.typeError('Unary - requires a numeric operand.');
      return -value;
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.advance();
    if (token.type === 'number' || token.type === 'string') return token.value;
    if (token.type === 'identifier') {
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'null') return null;
      if (FORBIDDEN_IDENTIFIERS.has(token.value) || /token|secret|credential|api.?key/i.test(token.value)) {
        this.syntax(`Identifier '${token.value}' is forbidden.`);
      }
      if (!Object.hasOwn(this.state, token.value)) this.syntax(`Unknown identifier '${token.value}'.`);
      const value = this.state[token.value];
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
      this.typeError(`Identifier '${token.value}' is not a scalar.`);
    }
    if (token.value === '(') {
      this.depth += 1;
      if (this.depth > MAX_DEPTH) this.syntax('Expression nesting is too deep.');
      const value = this.parseOr();
      this.expect(')');
      this.depth -= 1;
      return value;
    }
    this.syntax('Expected a literal, identifier, or parenthesized expression.');
  }

  peek() {
    return this.tokens[this.index];
  }

  advance() {
    return this.tokens[this.index++];
  }

  consume(value) {
    if (this.peek().value !== value) return false;
    this.advance();
    return true;
  }

  expect(value) {
    if (!this.consume(value)) this.syntax(`Expected '${value}'.`);
  }

  assertFinite(value) {
    if (!Number.isFinite(value)) this.typeError('Arithmetic result is not finite.');
  }

  syntax(message) {
    throw probeError('INVALID_EXPRESSION', `${message} At character ${this.peek().position}.`);
  }

  typeError(message) {
    throw probeError('INVALID_EXPRESSION', message);
  }
}

function tokenize(expression) {
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    if (/\s/.test(expression[index])) {
      index += 1;
      continue;
    }
    const start = index;
    const rest = expression.slice(index);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw probeError('INVALID_EXPRESSION', `Invalid number at character ${start}.`);
      tokens.push({ type: 'number', value, position: start });
      index += number[0].length;
    } else if (expression[index] === '"') {
      let end = index + 1;
      let escaped = false;
      while (end < expression.length) {
        const char = expression[end++];
        if (char === '"' && !escaped) break;
        if (char === '\\' && !escaped) escaped = true;
        else escaped = false;
      }
      const literal = expression.slice(index, end);
      let value;
      try {
        value = JSON.parse(literal);
      } catch {
        throw probeError('INVALID_EXPRESSION', `Invalid string literal at character ${start}.`);
      }
      tokens.push({ type: 'string', value, position: start });
      index = end;
    } else {
      const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
      if (identifier) {
        tokens.push({ type: 'identifier', value: identifier[0], position: start });
        index += identifier[0].length;
      } else {
        const operator = OPERATORS.find((item) => rest.startsWith(item));
        if (operator) {
          tokens.push({ type: 'operator', value: operator, position: start });
          index += operator.length;
        } else if ('()'.includes(expression[index])) {
          tokens.push({ type: 'punctuation', value: expression[index], position: start });
          index += 1;
        } else {
          throw probeError('INVALID_EXPRESSION', `Unexpected character at ${start}.`);
        }
      }
    }
    if (tokens.length >= MAX_TOKENS) throw probeError('EXPRESSION_TOO_COMPLEX', `Probe expressions cannot exceed ${MAX_TOKENS} tokens.`);
  }
  tokens.push({ type: 'eof', value: '', position: expression.length });
  return tokens;
}

function probeError(code, message) {
  return Object.assign(new Error(message), { code, probeSafe: true });
}
