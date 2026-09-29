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
import { GATE_REASONS, orderCallHash, outcomeOf } from '../src/gate';
import { ContractFunctionExecutionError, ContractFunctionRevertedError, encodeErrorResult } from 'viem';

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

describe('the gate steps', () => {
  it('hash an order exactly as the attestor and the venue do', async () => {
    // If these drift, a forged grant fails with CALL_MISMATCH instead of
    // BAD_SIGNATURE and the signature check is never actually exercised.
    const shared = await import('../../shared/src/grant');
    expect(orderCallHash('MON/USDC', 'buy', 20_000n)).toBe(
      shared.orderCallHash({ market: 'MON/USDC', side: 'buy', amount: 20_000n }),
    );
    expect([...GATE_REASONS]).toEqual([...shared.GATE_REASONS]);
  });

  it('reads a gate refusal by its reason, not as a generic failure', () => {
    const abi = [{ type: 'error', name: 'Refused', inputs: [{ name: 'reason', type: 'uint8' }] }] as const;
    const refusal = (code: number) =>
      new ContractFunctionExecutionError(
        new ContractFunctionRevertedError({
          abi,
          functionName: 'placeOrder',
          data: encodeErrorResult({ abi, errorName: 'Refused', args: [code] }),
        }),
        { abi, functionName: 'placeOrder' },
      );
    expect(outcomeOf(refusal(9))).toEqual({ kind: 'refused', reason: 'BAD_SIGNATURE' });
    expect(outcomeOf(refusal(2))).toEqual({ kind: 'refused', reason: 'CALL_MISMATCH' });
    // Anything else -- out of gas, a missing contract -- must not pass for a refusal.
    expect(outcomeOf(new Error('fetch failed')).kind).toBe('error');
  });

  it('takes the gate and venue from the tool, never from the service', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/gate.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/fetch\(|baseUrl|network\/status/);
  });

  it('still attacks the gate when the service is down', async () => {
    // The service fails at step 2; the gate steps must still be attempted,
    // since they are the ones that do not depend on it.
    const steps = await check({
      url: 'https://chancela.invalid',
      rpc: 'https://rpc.invalid',
      sourcify: false,
      fetch: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });
    expect(steps.some((s) => /venue|gate/i.test(s.title))).toBe(true);
    expect(steps.every((s) => !s.ok)).toBe(true);
  });
});
