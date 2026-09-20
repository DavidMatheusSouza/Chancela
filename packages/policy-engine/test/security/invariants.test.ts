import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, TOOL_REGISTRY } from '@chancela/shared';
import { evaluate } from '../../src/index';
import { agent, input, salesPolicy } from '../fixtures';

const evaluateSource = readFileSync(
  fileURLToPath(new URL('../../src/evaluate.ts', import.meta.url)),
  'utf8',
);

describe('structural invariants', () => {
  it("has exactly one place in the source that can produce 'ALLOW'", () => {
    // Guards against someone adding an early-return shortcut later.
    const allowReturns = evaluateSource.match(/build\(\s*input,\s*'ALLOW'/g) ?? [];
    expect(allowReturns).toHaveLength(1);
  });

  it('the single ALLOW is the last statement of the pipeline', () => {
    const allowIdx = evaluateSource.indexOf("build(input, 'ALLOW'");
    const stepUpIdx = evaluateSource.indexOf("name: 'step-up'");
    expect(allowIdx).toBeGreaterThan(stepUpIdx);
  });

  it('every registered tool declares a permission that exists in the catalogue', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(PERMISSIONS as readonly string[]).toContain(tool.requiredPermission);
    }
  });

  it('every tool that moves value is CRITICAL', () => {
    for (const tool of TOOL_REGISTRY.filter((t) => t.movesValue)) {
      expect(tool.risk).toBe('CRITICAL');
    }
  });
});

describe('fail-closed under arbitrary input', () => {
  it('never throws, whatever it is handed', () => {
    fc.assert(
      fc.property(
        fc.record({
          action: fc.string(),
          parameters: fc.dictionary(fc.string(), fc.anything()),
          now: fc.integer(),
          nonce: fc.string(),
        }),
        (raw) => {
          expect(() =>
            evaluate({
              agent,
              policy: salesPolicy,
              policyId: 'pol_1',
              action: raw.action,
              parameters: raw.parameters as Record<string, unknown>,
              now: raw.now,
              nonce: raw.nonce,
            }),
          ).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never allows an action outside the tool registry', () => {
    const known = new Set(TOOL_REGISTRY.map((t) => t.toolId));
    fc.assert(
      fc.property(fc.string(), (action) => {
        fc.pre(!known.has(action));
        const r = evaluate(input({ action }));
        expect(r.decision).not.toBe('ALLOW');
      }),
      { numRuns: 300 },
    );
  });

  it('never allows an action whose permission the policy does not grant', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TOOL_REGISTRY.map((t) => t.toolId)), (action) => {
        const tool = TOOL_REGISTRY.find((t) => t.toolId === action)!;
        fc.pre(!salesPolicy.permissions.includes(tool.requiredPermission));
        const r = evaluate(input({ action }));
        expect(r.decision).not.toBe('ALLOW');
      }),
      { numRuns: 200 },
    );
  });
});

describe('determinism', () => {
  it('identical input yields an identical decision hash', () => {
    const a = evaluate(input());
    const b = evaluate(input());
    expect(a.decisionHash).toBe(b.decisionHash);
    expect(a.intentHash).toBe(b.intentHash);
    expect(a.policyHash).toBe(b.policyHash);
  });

  it('parameter key order does not change the intent hash', () => {
    const a = evaluate(
      input({ action: 'CREATE_CUSTOMER', parameters: { name: 'Joao', email: 'j@x.com' } }),
    );
    const b = evaluate(
      input({ action: 'CREATE_CUSTOMER', parameters: { email: 'j@x.com', name: 'Joao' } }),
    );
    expect(a.intentHash).toBe(b.intentHash);
  });

  it('permission order does not change the policy hash', () => {
    const a = evaluate(input());
    const b = evaluate(
      input({
        policy: {
          ...salesPolicy,
          permissions: [...salesPolicy.permissions].reverse(),
        },
      }),
    );
    expect(a.policyHash).toBe(b.policyHash);
  });

  it('changing one permission changes the policy hash', () => {
    const a = evaluate(input());
    const b = evaluate(
      input({
        policy: { ...salesPolicy, permissions: [...salesPolicy.permissions, 'TRANSFER_FUNDS'] },
      }),
    );
    expect(a.policyHash).not.toBe(b.policyHash);
  });

  it('a different nonce yields a different decision hash (replay protection)', () => {
    const a = evaluate(input({ nonce: 'nonce-a' }));
    const b = evaluate(input({ nonce: 'nonce-b' }));
    expect(a.decisionHash).not.toBe(b.decisionHash);
  });

  it('capsules expire, and the TTL is short', () => {
    const r = evaluate(input());
    expect(r.capsule.expiresAt - r.capsule.issuedAt).toBeLessThanOrEqual(60);
  });
});
