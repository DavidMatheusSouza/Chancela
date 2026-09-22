import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

process.env.NANSEN_API_KEY = 'test-key';
const { lookupCounterparty, NANSEN_LABELS_URL } = await import('../src/lib/nansen.js');

afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  delete process.env.NANSEN_API_KEY;
});

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

function stubNansen(labels: string[], status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: labels.map((label) => ({ label, category: 'behavioral' })) }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

describe('Nansen counterparty labels', () => {
  it('asks the documented v1 endpoint for this address on Monad', async () => {
    const calls = stubNansen([]);
    await lookupCounterparty(addr(1));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(NANSEN_LABELS_URL);
    expect(NANSEN_LABELS_URL).toBe('https://api.nansen.ai/api/v1/profiler/address/labels');
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe('test-key');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ address: addr(1), chain: 'monad' });
  });

  it('turns a dangerous label into a severe risk signal', async () => {
    stubNansen(['Tornado Cash User', 'DeFi User']);
    const [signal] = await lookupCounterparty(addr(2));
    expect(signal).toMatchObject({ source: 'NANSEN', severity: 95 });
    expect(signal!.labels).toContain('Tornado Cash User');
  });

  it('reports nothing for an ordinary address', async () => {
    stubNansen(['DeFi User']);
    const signals = await lookupCounterparty(addr(3));
    expect(signals[0]?.severity ?? 0).toBe(0);
  });

  it('falls back to the local denylist, never to "all clear", when Nansen fails', async () => {
    stubNansen([], 500);
    const flagged = `0x${'1'.repeat(37)}bad`;
    const signals = await lookupCounterparty(flagged);
    expect(signals[0]).toMatchObject({ source: 'INTERNAL', severity: 90 });
  });
});
