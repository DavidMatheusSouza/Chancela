import { canonicalJSON, hashIntent } from '@chancela/shared';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';
import { ChancelaError, createClient, type Capsule, type Decision } from '../src/index';

// Anvil test vectors -- published keys, not secrets.
const attestor = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const impostor = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

const NOW = 1_800_000_000;
const PARAMS = { amount: 5000, recipientAddress: '0x000000000000000000000000000000000000dEaD' };

async function answer(over: Partial<Capsule> = {}, signer = attestor): Promise<Decision> {
  const capsule: Capsule = {
    version: 1,
    agentId: 'TA-003',
    ownerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    action: 'TRANSFER_FUNDS',
    intentHash: hashIntent({ agentId: 'TA-003', action: 'TRANSFER_FUNDS', parameters: PARAMS }),
    policyId: 'pol_TA-003_v2',
    policyVersion: 2,
    policyHash: `0x${'ab'.repeat(32)}`,
    decision: 'ALLOW',
    risk: 'MEDIUM',
    reasonCode: 'OK',
    nonce: 'n-1',
    issuedAt: NOW - 1,
    expiresAt: NOW + 60,
    decisionHash: `0x${'cd'.repeat(32)}`,
    ...over,
  };
  return {
    decision: capsule.decision,
    reasonCode: capsule.reasonCode,
    reasonText: 'text',
    risk: capsule.risk,
    auditId: 'TA-AUDIT-1',
    policyVersion: 2,
    policyHash: capsule.policyHash,
    decisionHash: capsule.decisionHash,
    capsule,
    signature: await signer.signMessage({ message: canonicalJSON(capsule) }),
    attestationAddress: signer.address,
    anchorStatus: 'PENDING',
  };
}

const serving = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const client = (f: typeof fetch) =>
  createClient({ baseUrl: 'https://chancela.test/', attestor: attestor.address, fetch: f, now: () => NOW });

const EXPECTED = { agentId: 'TA-003', action: 'TRANSFER_FUNDS', parameters: PARAMS };

describe('verify', () => {
  it('accepts a permission signed by the expected attestor', async () => {
    expect(await client(serving({})).verify(await answer(), EXPECTED)).toEqual({ ok: true, code: 'OK' });
  });

  it('refuses a permission the server signed with a key of its own', async () => {
    // The response even names the impostor as its attestor; that claim is ignored.
    const verdict = await client(serving({})).verify(await answer({}, impostor), EXPECTED);
    expect(verdict.code).toBe('WRONG_ATTESTOR');
  });

  it('refuses when the parameters about to be used are not the ones authorized', async () => {
    const verdict = await client(serving({})).verify(await answer(), {
      ...EXPECTED,
      parameters: { ...PARAMS, amount: 500_000 },
    });
    expect(verdict.code).toBe('INTENT_MISMATCH');
  });

  it('refuses a capsule edited after signing', async () => {
    const d = await answer();
    d.capsule = { ...d.capsule, expiresAt: NOW + 86_400 };
    expect((await client(serving({})).verify(d, EXPECTED)).code).toBe('WRONG_ATTESTOR');
  });

  it('refuses an expired permission, a DENY, and one for another agent', async () => {
    const c = client(serving({}));
    expect((await c.verify(await answer({ expiresAt: NOW }), EXPECTED)).code).toBe('EXPIRED');
    expect((await c.verify(await answer({ decision: 'DENY', reasonCode: 'PERMISSION_DENIED' }), EXPECTED)).code).toBe('NOT_AUTHORIZED');
    expect((await c.verify(await answer({ agentId: 'TA-001' }), EXPECTED)).code).toBe('WRONG_AGENT_OR_ACTION');
  });

  it('cannot say yes without an attestor to check against', async () => {
    const c = createClient({ baseUrl: 'https://chancela.test', fetch: serving({}), now: () => NOW });
    expect((await c.verify(await answer(), EXPECTED)).code).toBe('WRONG_ATTESTOR');
  });

  it('asks the resolver which attestor the owner registered', async () => {
    const resolver = vi.fn(async () => attestor.address);
    const c = createClient({ baseUrl: 'https://chancela.test', attestor: resolver, fetch: serving({}), now: () => NOW });
    expect((await c.verify(await answer(), EXPECTED)).ok).toBe(true);
    expect(resolver).toHaveBeenCalledWith('TA-003');
  });
});

describe('guard', () => {
  it('runs the action once the permission verifies', async () => {
    const act = vi.fn(() => 'sent');
    expect(await client(serving(await answer())).guard('TA-003', 'TRANSFER_FUNDS', PARAMS, act)).toBe('sent');
    expect(act).toHaveBeenCalledOnce();
  });

  it.each([
    ['a refusal', async () => serving(await answer({ decision: 'DENY', reasonCode: 'PERMISSION_DENIED' })), 'DENIED'],
    ['a step-up', async () => serving(await answer({ decision: 'REQUIRE_APPROVAL' })), 'APPROVAL_REQUIRED'],
    ['a forged ALLOW', async () => serving(await answer({}, impostor)), 'UNVERIFIED_WRONG_ATTESTOR'],
    ['a server error', async () => serving({ error: { code: 'INTERNAL', message: 'boom' } }, 500), 'INTERNAL'],
    ['an answer with no capsule', async () => serving({ decision: 'ALLOW' }), 'MALFORMED'],
  ])('never runs the action on %s', async (_name, make, code) => {
    const act = vi.fn();
    const attempt = client(await make()).guard('TA-003', 'TRANSFER_FUNDS', PARAMS, act);
    await expect(attempt).rejects.toMatchObject({ code });
    await expect(attempt).rejects.toBeInstanceOf(ChancelaError);
    expect(act).not.toHaveBeenCalled();
  });

  it('treats an unreachable deployment as a refusal, never as permission', async () => {
    const act = vi.fn();
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(client(down).guard('TA-003', 'TRANSFER_FUNDS', PARAMS, act)).rejects.toMatchObject({ code: 'UNREACHABLE' });
    expect(act).not.toHaveBeenCalled();
  });
});
