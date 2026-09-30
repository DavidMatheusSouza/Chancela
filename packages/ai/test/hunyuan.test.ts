import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_TOOL_CATALOGUE, availableProviders, createHunyuanProvider, resolveProvider } from '../src/index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('asks TokenHub for hy4-preview with a JSON object reply', async () => {
  let url: unknown;
  let body: Record<string, unknown> = {};
  vi.stubGlobal('fetch', async (u: unknown, init: RequestInit) => {
    url = u;
    body = JSON.parse(String(init.body));
    const content = JSON.stringify({ action: 'CREATE_CUSTOMER', parameters: { name: 'Maria' }, confidence: 0.9, rationale: 'r' });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      headers: { 'content-type': 'application/json' },
    });
  });

  const result = await createHunyuanProvider('k').extractIntent({
    utterance: 'create customer Maria',
    toolCatalog: DEFAULT_TOOL_CATALOGUE,
    agentName: 'A',
  });

  expect(url).toBe('https://tokenhub-intl.tencentcloudmaas.com/v1/chat/completions');
  expect(body.model).toBe('hy4-preview');
  expect(body.response_format).toEqual({ type: 'json_object' });
  expect(result.provider).toBe('hunyuan');
  expect(result.intent.action).toBe('CREATE_CUSTOMER');
});

it('is picked by name, and reported as configured only with a key', () => {
  vi.stubEnv('HUNYUAN_API_KEY', '');
  expect(availableProviders().find((p) => p.id === 'hunyuan')?.configured).toBe(false);
  expect(resolveProvider('hunyuan').name).toBe('rules');

  vi.stubEnv('HUNYUAN_API_KEY', 'k');
  expect(availableProviders().find((p) => p.id === 'hunyuan')?.configured).toBe(true);
  expect(resolveProvider('hunyuan').name).toBe('hunyuan');
});
