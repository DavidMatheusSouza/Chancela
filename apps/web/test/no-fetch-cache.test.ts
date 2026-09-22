import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Next.js caches server-side fetches -- POSTs included -- unless told not to,
 * and JSON-RPC is all POSTs. This once had /api/network/status reporting a
 * balance and a block number from long before the request. Every read of the
 * chain must say `no-store`.
 */
describe('RPC reads are never served from a cache', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks fetch not to store the answer', async () => {
    const inits: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      inits.push(init);
      const { id } = JSON.parse(String(init.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: '0x10' }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    const { publicClient } = await import('../src/lib/chain.js');
    await expect(publicClient().getBlockNumber({ cacheTime: 0 })).resolves.toBe(16n);
    expect(inits.length).toBeGreaterThan(0);
    for (const init of inits) expect(init.cache).toBe('no-store');
  });
});
