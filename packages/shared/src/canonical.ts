/**
 * Canonical JSON serialisation.
 *
 * Every hash that ends up on-chain is computed over the output of this
 * function. If two parties serialise the same logical object differently, the
 * hashes diverge and the whole accountability chain silently breaks -- so this
 * module is deliberately strict and deliberately boring.
 *
 * Rules (a pragmatic subset of RFC 8785 / JCS):
 *  - object keys sorted by UTF-16 code unit, recursively
 *  - no insignificant whitespace
 *  - `undefined` properties are dropped; `undefined` array items become null
 *  - non-finite numbers are rejected rather than coerced to null
 *  - bigint is rejected: callers must decide on a string/number encoding
 */

export class CanonicalisationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} (at ${path || '<root>'})`);
    this.name = 'CanonicalisationError';
  }
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalisationError('Non-finite number is not canonicalisable', path);
      }
      // Normalise -0 to 0 so that two logically equal policies hash equally.
      return Object.is(value, -0) ? '0' : JSON.stringify(value);

    case 'string':
      return JSON.stringify(value);

    case 'bigint':
      throw new CanonicalisationError(
        'bigint is not canonicalisable: encode it as a decimal string first',
        path,
      );

    case 'undefined':
      throw new CanonicalisationError('undefined is not canonicalisable', path);

    case 'function':
    case 'symbol':
      throw new CanonicalisationError(`${typeof value} is not canonicalisable`, path);

    case 'object':
      break;

    default:
      throw new CanonicalisationError(`Unsupported type ${typeof value}`, path);
  }

  if (Array.isArray(value)) {
    const items = value.map((item, i) =>
      item === undefined ? 'null' : encode(item, `${path}[${i}]`),
    );
    return `[${items.join(',')}]`;
  }

  if (value instanceof Date) {
    // Dates are ambiguous across timezones/precision. Force the caller to be explicit.
    throw new CanonicalisationError(
      'Date is not canonicalisable: pass an ISO-8601 string or epoch integer',
      path,
    );
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();

  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${encode(record[k], path ? `${path}.${k}` : k)}`,
  );
  return `{${entries.join(',')}}`;
}

/** Deterministic string form of `value`. Same logical input => same bytes, always. */
export function canonicalJSON(value: unknown): string {
  return encode(value, '');
}

/** Convenience: parse then re-serialise, to normalise an untrusted JSON string. */
export function canonicaliseJSONString(raw: string): string {
  return canonicalJSON(JSON.parse(raw) as Json);
}
