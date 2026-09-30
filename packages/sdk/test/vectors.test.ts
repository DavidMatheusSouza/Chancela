import { readFileSync } from 'node:fs';
import { canonicalJSON, hashIntent } from '@chancela/shared';
import { describe, expect, it } from 'vitest';
import { createClient, type Decision } from '../src/index';

/**
 * The fixture the Python client (examples/trading-agent) is tested against.
 * If the TypeScript encoding changes, this fails here first -- and regenerating
 * the fixture then fails test_chancela.py until the Python side matches.
 */
const V = JSON.parse(
  readFileSync(new URL('../../../examples/trading-agent/vectors.json', import.meta.url), 'utf8'),
);

describe('cross-language vectors', () => {
  it('canonical JSON and intent hash match the fixture', () => {
    for (const c of V.cases) {
      expect(canonicalJSON(c.parameters)).toBe(c.canonical);
      expect(hashIntent({ agentId: V.agentId, action: V.action, parameters: c.parameters })).toBe(c.intentHash);
    }
  });

  it('the signed capsule verifies with the SDK', async () => {
    const s = V.signed;
    const chancela = createClient({ baseUrl: 'http://127.0.0.1:9', attestor: s.attestor, now: () => s.now });
    const verdict = await chancela.verify({ capsule: s.capsule, signature: s.signature } as Decision, {
      agentId: V.agentId,
      action: V.action,
      parameters: s.parameters,
    });
    expect(verdict).toEqual({ ok: true, code: 'OK' });
  });
});
