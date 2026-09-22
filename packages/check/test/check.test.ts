/**
 * The checker's own failure modes.
 *
 * What matters here is not that it passes against the live deployment -- it
 * does, and that is what the command is for -- but that it *fails* when it
 * should. A verifier that says ✓ no matter what is worse than none, because it
 * is quoted in a README.
 *
 * The chain is not stubbed: these drive the parts that run before it and the
 * pure helpers, and assert the shape of what comes back.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, tokenIdFromAgentId, check } from '../src/check';

describe('token id', () => {
  it('reads the trailing number of an agent id', () => {
    expect(tokenIdFromAgentId('TA-001')).toBe(1n);
    expect(tokenIdFromAgentId('TA-042')).toBe(42n);
    expect(tokenIdFromAgentId('agent-7')).toBe(7n);
  });

  it('refuses to guess, rather than checking the wrong agent', () => {
    // Silently defaulting to token 1 would check an agent whose attestor the
    // service may well control, and print a tick for it.
    expect(() => tokenIdFromAgentId('sales-agent')).toThrow(/--token-id/);
  });
});

describe('defaults', () => {
  it('names the documented deployment and registry', () => {
    expect(DEFAULTS.url).toBe('https://chancela.xyz');
    expect(DEFAULTS.registry).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(DEFAULTS.chainId).toBe(10143);
  });

  it('does not take the registry address from the service under test', async () => {
    // The whole point: if the deployment could name its own registry, it could
    // name one whose attestorOf() returns a key it holds.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/check.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/network\/status/);
  });
});

describe('when the deployment is unreachable', () => {
  it('reports a failed step rather than throwing, and never a tick', async () => {
    const steps = await check({
      url: 'https://chancela.invalid',
      rpc: 'https://rpc.invalid',
      sourcify: false,
      fetch: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => !s.ok)).toBe(true);
  });
});
