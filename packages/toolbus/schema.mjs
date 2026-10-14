export function validateSchema(value, schema, pointer = '') {
  const issues = [];
  const add = (message, path = pointer || '/') => issues.push({
    code: 'INVALID_ARGUMENTS',
    pointer: path,
    message,
    severity: 'error',
  });
  if (!schema || typeof schema !== 'object') return issues;
  if (schema.enum && !schema.enum.some((entry) => deepEqual(entry, value))) {
    add(`must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}`);
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    add(`must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      add('must be an object');
      return issues;
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) add('is required', `${pointer}/${escapePointer(key)}`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) add('is not allowed', `${pointer}/${escapePointer(key)}`);
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          issues.push(...validateSchema(child, schema.additionalProperties, `${pointer}/${escapePointer(key)}`));
        }
        continue;
      }
      issues.push(...validateSchema(child, childSchema, `${pointer}/${escapePointer(key)}`));
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) add('must be an array');
    else {
      if (schema.minItems !== undefined && value.length < schema.minItems) add(`must contain at least ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`must contain at most ${schema.maxItems} items`);
      if (schema.items) value.forEach((item, index) => {
        issues.push(...validateSchema(item, schema.items, `${pointer}/${index}`));
      });
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') add('must be a string');
    else {
      if (schema.minLength !== undefined && value.length < schema.minLength) add(`must contain at least ${schema.minLength} characters`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) add(`must contain at most ${schema.maxLength} characters`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) add('does not match the required pattern');
    }
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) add('must be an integer');
    else validateNumberBounds(value, schema, add);
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) add('must be a finite number');
    else validateNumberBounds(value, schema, add);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    add('must be a boolean');
  }
  return issues;
}

function validateNumberBounds(value, schema, add) {
  if (schema.minimum !== undefined && value < schema.minimum) add(`must be >= ${schema.minimum}`);
  if (schema.maximum !== undefined && value > schema.maximum) add(`must be <= ${schema.maximum}`);
}

function escapePointer(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left).sort();
  const b = Object.keys(right).sort();
  return a.length === b.length && a.every((key, index) =>
    key === b[index] && deepEqual(left[key], right[key]));
}
