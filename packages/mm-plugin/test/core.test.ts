import { describe, expect, it } from 'vitest';
import { ChancelaError, assertAllowed, audit, authorize, parseParams, passport, resolveApiUrl } from '../src/core.js';

const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const decision = (over: Record<string, unknown> = {}) => ({
  decision: 'ALLOW', risk: 'LOW', reasonCode: 'OK', reasonText: 'Authorized by policy.',
  policyVersion: 3, policyHash: '0xcd0f', auditId: 'TA-AUDIT-1', decisionHash: '0x1889',
  anchorStatus: 'PENDING', ...over,
});

describe('authorize', () => {
  it('returns an ALLOW untouched', async () => {
    const d = await authorize({ apiUrl: 'https://c', fetch: json(decision()) }, 'TA-001', 'CREATE_CUSTOMER', {});
    expect(assertAllowed(d).decision).toBe('ALLOW');
  });

  it('turns a DENY into an error, because only a non-zero exit stops the next command', async () => {
    const d = await authorize(
      { apiUrl: 'https://c', fetch: json(decision({ decision: 'DENY', risk: 'CRITICAL', reasonCode: 'PERMISSION_DENIED', reasonText: 'No permission.' })) },
      'TA-001', 'TRANSFER_FUNDS', { amount: 1 },
    );
    expect(() => assertAllowed(d)).toThrowError(ChancelaError);
    try { assertAllowed(d); } catch (e) {
      expect((e as ChancelaError).code).toBe('CHANCELA_DENIED');
      expect((e as ChancelaError).hint).toMatch(/do not rephrase/i);
    }
  });

  it('treats REQUIRE_APPROVAL as not-allowed too', async () => {
    const d = await authorize({ apiUrl: 'https://c', fetch: json(decision({ decision: 'REQUIRE_APPROVAL', risk: 'HIGH' })) }, 'TA-001', 'CHANGE_POLICY', {});
    expect(() => assertAllowed(d)).toThrowError(/approval/i);
  });

  it('tells the agent to stop retrying when the breaker has suspended it', async () => {
    const d = await authorize({ apiUrl: 'https://c', fetch: json(decision({ decision: 'DENY', reasonCode: 'AGENT_SUSPENDED' })) }, 'TA-001', 'CREATE_CUSTOMER', {});
    expect(d.agentSuspended).toBe(true);
    try { assertAllowed(d); } catch (e) { expect((e as ChancelaError).hint).toMatch(/suspended/i); }
  });

  it('fails closed when Chancela is unreachable — no answer is not permission', async () => {
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(authorize({ apiUrl: 'https://c', fetch: down }, 'TA-001', 'X', {})).rejects.toMatchObject({ code: 'CHANCELA_UNREACHABLE' });
  });

  it('surfaces a server error as an error, never as a decision', async () => {
    await expect(
      authorize({ apiUrl: 'https://c', fetch: json({ error: { code: 'NOT_FOUND', message: 'Unknown agent' } }, 404) }, 'TA-404', 'X', {}),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('inputs', () => {
  it('requires a deployment URL rather than guessing one', () => {
    expect(() => resolveApiUrl(undefined, {})).toThrowError(/No Chancela deployment/);
    expect(resolveApiUrl('https://c.xyz/', {})).toBe('https://c.xyz');
    expect(resolveApiUrl(undefined, { CHANCELA_API_URL: 'https://env' })).toBe('https://env');
  });

  it('accepts only a JSON object for --params', () => {
    expect(parseParams('{"a":1}')).toEqual({ a: 1 });
    expect(parseParams(undefined)).toEqual({});
    for (const bad of ['[1]', '"x"', 'not json', '5']) expect(() => parseParams(bad)).toThrowError(ChancelaError);
  });
});

describe('read commands', () => {
  it('summarises a passport', async () => {
    const p = await passport({ apiUrl: 'https://c', fetch: json({
      agent: { id: 'TA-001', name: 'SalesAgent', status: 'ACTIVE', erc8004TokenId: '1' },
      policy: { version: 3, policyHash: '0xcd', document: { permissions: ['READ_CUSTOMERS'] } },
      trustScore: { score: 92 },
    }) }, 'TA-001');
    expect(p).toMatchObject({ identity: 'ERC-8004 #1', policyVersion: 3, permissions: ['READ_CUSTOMERS'], wallet: null });
  });

  it('clamps the audit limit', async () => {
    let seen = '';
    const spy = (async (url: string) => { seen = url; return new Response(JSON.stringify({ events: [] })); }) as unknown as typeof fetch;
    await audit({ apiUrl: 'https://c', fetch: spy }, 'TA-001', 99999);
    expect(seen).toContain('limit=200');
  });
});
