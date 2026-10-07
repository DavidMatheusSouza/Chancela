import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

process.env.NANSEN_API_KEY = 'test-key';
const { nansenStatus, probeNansen } = await import('../src/lib/nansen.js');

afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  delete process.env.NANSEN_API_KEY;
});

describe('what /integrations says about Nansen', () => {
  it('reports an account out of credits instead of the key being present', async () => {
    expect(nansenStatus().detail).toContain('no lookup made');

    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return new Response(JSON.stringify({ code: 'insufficient_credits', status: 403 }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    });

    await probeNansen();
    expect(calls).toBe(1);
    expect(nansenStatus().status).toBe('FALLBACK');
    expect(nansenStatus().detail).toContain('insufficient_credits');

    // One question per process is enough to know; the page is not a credit meter.
    await probeNansen();
    expect(calls).toBe(1);
  });
});
