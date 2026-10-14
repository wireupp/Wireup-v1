/**
 * Canonical JSON.
 *
 * Determinism is invariant I9: the same graph and the same seed must produce the same
 * result. Hashes, artifact ids and telemetry comparisons all depend on one canonical
 * serialisation, so this is deliberately strict:
 *   - object keys sorted
 *   - no insignificant whitespace
 *   - `-0` normalised to `0`
 *   - non-finite numbers rejected, never emitted as null
 */

/** @param {unknown} value */
export function canonicalize(value) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonical JSON cannot represent ${value}`);
    }
    // Collapse -0 so a sign flip cannot change a hash.
    return value === 0 ? 0 : value;
  }
  if (t === 'string' || t === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (t === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(/** @type {object} */ (value)).sort()) {
      const v = /** @type {Record<string, unknown>} */ (value)[key];
      if (v === undefined) continue; // undefined is absence, not a value
      out[key] = canonicalize(v);
    }
    return out;
  }
  throw new TypeError(`canonical JSON cannot represent a ${t}`);
}

/** @param {unknown} value */
export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * Stable content hash. Uses SHA-256 via WebCrypto where available, falling back to a
 * documented FNV-1a. Both are deterministic; the fallback exists so this file runs under
 * bare `node` in every checkout.
 *
 * @param {unknown} value
 * @returns {Promise<string>}
 */
export async function canonicalHash(value) {
  const text = canonicalStringify(value);
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `fnv1a-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** Deep structural equality via canonical form. Cheap enough for store-level assertions. */
/** @param {unknown} a @param {unknown} b */
export function deepEqual(a, b) {
  return canonicalStringify(a) === canonicalStringify(b);
}

/** Deep clone through canonical form, so a store can never hand out a mutable reference. */
/** @template T @param {T} value @returns {T} */
export function clone(value) {
  return /** @type {T} */ (JSON.parse(canonicalStringify(value)));
}