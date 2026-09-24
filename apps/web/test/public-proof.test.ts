import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, type Hex } from 'viem';
import { NextRequest } from 'next/server';

const REGISTRY = '0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e';
process.env.POLICY_REGISTRY_ADDRESS = REGISTRY;
process.env.SESSION_SECRET = 'a'.repeat(64);

const { POLICY_REGISTRY_ABI, readAnchor } = await import('../src/lib/chain.js');
const { middleware } = await import('../src/middleware.js');

const TX = `0x${'ab'.repeat(32)}` as Hex;
const FROM = '0xeaeeD927eB8eEF8b1ae933BFEcBC6BE492799F5F';
const DECISION = `0x${'11'.repeat(32)}` as Hex;
const INTENT = `0x${'22'.repeat(32)}` as Hex;
const POLICY = `0x${'33'.repeat(32)}` as Hex;

const recordCall = encodeFunctionData({
  abi: POLICY_REGISTRY_ABI,
  functionName: 'recordDecision',
  args: [
    {
      agentTokenId: 1n,
      decisionHash: DECISION,
      intentHash: INTENT,
      action: '0x12345678',
      decision: 1,
      risk: 3,
      policyHash: POLICY,
    },
  ],
});

/** A fake Monad node that knows exactly one transaction. */
function stubChain(tx: { to: string; input: Hex; status: '0x1' | '0x0' }) {
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const calls = Array.isArray(body) ? body : [body];
    const answer = (c: { id: number; method: string }) => {
      const base = {
        blockHash: `0x${'cd'.repeat(32)}`,
        blockNumber: '0x10',
        transactionHash: TX,
        transactionIndex: '0x0',
        from: FROM,
        to: tx.to,
      };
      const result =
        c.method === 'eth_getTransactionByHash'
          ? { ...base, hash: TX, input: tx.input, nonce: '0x1', gas: '0x1', gasPrice: '0x1', value: '0x0', type: '0x0', v: '0x1b', r: '0x1', s: '0x1', chainId: '0x279f' }
          : c.method === 'eth_getTransactionReceipt'
            ? { ...base, status: tx.status, logs: [], cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x1', logsBloom: `0x${'00'.repeat(256)}`, contractAddress: null, type: '0x0' }
            : null;
      return { jsonrpc: '2.0', id: c.id, result };
    };
    const out = Array.isArray(body) ? calls.map(answer) : answer(body);
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  });
}

describe('reading an anchor back from Monad', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('decodes the hashes the registry was actually given', async () => {
    stubChain({ to: REGISTRY, input: recordCall, status: '0x1' });
    const anchor = await readAnchor(TX);
    expect(anchor?.ok).toBe(true);
    expect(anchor?.decisionHash).toBe(DECISION);
    expect(anchor?.intentHash).toBe(INTENT);
    expect(anchor?.policyHash).toBe(POLICY);
    expect(anchor?.blockNumber).toBe('16');
  });

  it('does not accept the same calldata sent to some other contract', async () => {
    stubChain({ to: '0x000000000000000000000000000000000000dEaD', input: recordCall, status: '0x1' });
    expect((await readAnchor(TX))?.ok).toBe(false);
  });

  it('does not accept a reverted transaction', async () => {
    stubChain({ to: REGISTRY, input: recordCall, status: '0x0' });
    expect((await readAnchor(TX))?.ok).toBe(false);
  });

  it('does not accept a transaction that is not recordDecision', async () => {
    stubChain({ to: REGISTRY, input: '0xdeadbeef', status: '0x1' });
    const anchor = await readAnchor(TX);
    expect(anchor?.ok).toBe(false);
    expect(anchor?.decisionHash).toBeNull();
  });

  it('says "unknown" rather than "failed" when the chain cannot be read', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect(await readAnchor(TX)).toBeNull();
    expect(await readAnchor('not-a-hash')).toBeNull();
  });
});

describe('the public ledger needs no session', () => {
  const status = async (path: string) =>
    (await middleware(new NextRequest(new URL(path, 'https://chancela.xyz')))).status;

  it('opens the ledger and single proofs', async () => {
    expect(await status('/live')).toBe(200);
    expect(await status('/proof/TA-AUDIT-9E82C2C1')).toBe(200);
  });

  it('opens nothing beside them', async () => {
    expect(await status('/proof/x/edit')).toBe(307);
    expect(await status('/proofs')).toBe(307);
    expect(await status('/live/admin')).toBe(307);
    expect(await status('/dashboard')).toBe(307);
  });
});
