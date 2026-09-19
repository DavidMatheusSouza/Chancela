import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CanonicalisationError,
  canonicalJSON,
  hashIntent,
  hashObject,
  hashPolicyDocument,
} from '../src/index';

/**
 * Canonicalisation is the root of every proof in the system. If two parties
 * serialise the same object differently, every hash downstream diverges and the
 * accountability chain silently breaks. These tests are the guarantee.
 */
describe('canonicalJSON', () => {
  it('sorts object keys', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys recursively', () => {
    expect(canonicalJSON({ z: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"z":{"c":2,"d":1}}');
  });

  it('preserves array order', () => {
    expect(canonicalJSON([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined properties but keeps undefined array slots as null', () => {
    expect(canonicalJSON({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJSON([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('normalises negative zero', () => {
    expect(canonicalJSON({ n: -0 })).toBe(canonicalJSON({ n: 0 }));
  });

  it('rejects non-finite numbers instead of coercing them to null', () => {
    expect(() => canonicalJSON({ n: Number.NaN })).toThrow(CanonicalisationError);
    expect(() => canonicalJSON({ n: Number.POSITIVE_INFINITY })).toThrow(CanonicalisationError);
  });

  it('rejects bigint rather than guessing an encoding', () => {
    expect(() => canonicalJSON({ n: 1n })).toThrow(CanonicalisationError);
  });

  it('rejects Date rather than guessing a precision', () => {
    expect(() => canonicalJSON({ d: new Date(0) })).toThrow(CanonicalisationError);
  });

  it('names the path of the offending value', () => {
    try {
      canonicalJSON({ outer: { inner: [1, Number.NaN] } });
      expect.unreachable();
    } catch (err) {
      expect((err as CanonicalisationError).path).toBe('outer.inner[1]');
    }
  });

  it('escapes strings exactly as JSON.stringify does', () => {
    const tricky = 'quote " backslash \\ newline \n unicode  ';
    expect(canonicalJSON({ s: tricky })).toBe(`{"s":${JSON.stringify(tricky)}}`);
  });

  it('is insensitive to key insertion order, for any object', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const shuffled = Object.fromEntries(Object.entries(obj).reverse());
        expect(canonicalJSON(shuffled)).toBe(canonicalJSON(obj));
      }),
      { numRuns: 300 },
    );
  });

  it('round-trips to an equal value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(canonicalJSON(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      { numRuns: 300 },
    );
  });
});

describe('hashing', () => {
  it('produces a 32-byte hex digest', () => {
    expect(hashObject({ a: 1 })).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('gives equal objects equal hashes regardless of key order', () => {
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }));
  });

  it('gives different objects different hashes', () => {
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });

  it('ignores permission ordering and duplicates in a policy hash', () => {
    const base = {
      agentId: 'TA-001',
      version: 1,
      limits: { maxTransactionValue: 0 },
      stepUpThreshold: 'HIGH',
    };
    const a = hashPolicyDocument({ ...base, permissions: ['A', 'B', 'C'] });
    const b = hashPolicyDocument({ ...base, permissions: ['C', 'B', 'A', 'A'] });
    expect(a).toBe(b);
  });

  it('changes the policy hash when a permission is added', () => {
    const base = {
      agentId: 'TA-001',
      version: 1,
      limits: { maxTransactionValue: 0 },
      stepUpThreshold: 'HIGH' as const,
    };
    expect(hashPolicyDocument({ ...base, permissions: ['A'] })).not.toBe(
      hashPolicyDocument({ ...base, permissions: ['A', 'B'] }),
    );
  });

  it('changes the policy hash when the version changes', () => {
    const base = { agentId: 'TA-001', permissions: ['A'], limits: {}, stepUpThreshold: 'HIGH' };
    expect(hashPolicyDocument({ ...base, version: 1 })).not.toBe(
      hashPolicyDocument({ ...base, version: 2 }),
    );
  });

  it('binds an intent hash to agent, action and parameters together', () => {
    const intent = { agentId: 'TA-001', action: 'CREATE_CUSTOMER', parameters: { name: 'Joao' } };
    expect(hashIntent(intent)).toBe(hashIntent({ ...intent }));
    expect(hashIntent(intent)).not.toBe(hashIntent({ ...intent, agentId: 'TA-002' }));
    expect(hashIntent(intent)).not.toBe(hashIntent({ ...intent, action: 'DELETE_CUSTOMER' }));
    expect(hashIntent(intent)).not.toBe(
      hashIntent({ ...intent, parameters: { name: 'Attacker' } }),
    );
  });

  it('distinguishes a nested value moved between keys', () => {
    // Guards against a naive concatenation-based canonicaliser.
    expect(hashObject({ a: 'x', b: '' })).not.toBe(hashObject({ a: '', b: 'x' }));
  });
});
