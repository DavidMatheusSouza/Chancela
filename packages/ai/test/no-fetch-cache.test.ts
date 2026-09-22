import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_TOOL_CATALOGUE, OpenAICompatibleProvider } from '../src/index';

afterEach(() => vi.unstubAllGlobals());

// Inside Next.js a cached POST would hand back an old model answer for a new
// request, and the demo's claim that a real model reads every request would
// quietly stop being true.
it('never lets the model call be answered from a cache', async () => {
  let init: RequestInit | undefined;
  vi.stubGlobal('fetch', async (_url: unknown, i: RequestInit) => {
    init = i;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
      headers: { 'content-type': 'application/json' },
    });
  });

  const provider = new OpenAICompatibleProvider({
    name: 'test',
    model: 'm',
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'k',
  });
  await provider
    .extractIntent({ utterance: 'hello', toolCatalog: DEFAULT_TOOL_CATALOGUE, agentName: 'A' })
    .catch(() => undefined);

  expect(init).toBeDefined();
  expect((init as { cache?: string }).cache).toBe('no-store');
});
