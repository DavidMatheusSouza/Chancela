import { beforeAll, describe, expect, it } from 'vitest';
import { hashIntent } from '@trustagent/shared';
import type { AuthorizationCapsule } from '@trustagent/shared';
import { attestationAddress, signCapsule, verifyCapsule } from '../src/lib/attestation.js';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const OTHER_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba';

const NOW = 1_760_000_000;
const params = { name: 'Joao' };

function capsule(over: Partial<AuthorizationCapsule> = {}): AuthorizationCapsule {
  const intentHash = hashIntent({ agentId: 'TA-001', action: 'CREATE_CUSTOMER', parameters: params });
  return {
    version: 1,
    agentId: 'TA-001',
    ownerAddress: '0x82f1aA0f3A1b2c3d4e5F60718293a4b5c6D7e891',
    action: 'CREATE_CUSTOMER',
    intentHash,
    policyId: 'pol_1',
    policyVersion: 3,
    policyHash: `0x${'ab'.repeat(32)}`,
    decision: 'ALLOW',
    risk: 'LOW',
    reasonCode: 'OK',
    nonce: 'nonce-0000-0001',
    issuedAt: NOW,
    expiresAt: NOW + 60,
    decisionHash: `0x${'cd'.repeat(32)}`,
    ...over,
  };
}

const never = () => false;

beforeAll(() => {
  process.env.ATTESTATION_PRIVATE_KEY = KEY;
});

describe('capsule attestation', () => {
  it('signs and verifies a well-formed capsule', async () => {
    const signed = await signCapsule(capsule());
    const r = await verifyCapsule(signed, { now: NOW + 1, parameters: params, isNonceUsed: never });
    expect(r.ok).toBe(true);
  });

  it('exposes a stable attestation address', () => {
    expect(attestationAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('rejects a capsule whose parameters were altered after the decision', async () => {
    const signed = await signCapsule(capsule());
    const r = await verifyCapsule(signed, {
      now: NOW + 1,
      parameters: { name: 'Attacker' },
      isNonceUsed: never,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INTENT_MISMATCH');
  });

  it('rejects an expired capsule', async () => {
    const signed = await signCapsule(capsule());
    const r = await verifyCapsule(signed, {
      now: NOW + 61,
      parameters: params,
      isNonceUsed: never,
    });
    expect(r.code).toBe('EXPIRED');
  });

  it('rejects a replayed nonce', async () => {
    const signed = await signCapsule(capsule());
    const r = await verifyCapsule(signed, {
      now: NOW + 1,
      parameters: params,
      isNonceUsed: () => true,
    });
    expect(r.code).toBe('REPLAYED');
  });

  it('rejects a capsule signed by the wrong key', async () => {
    process.env.ATTESTATION_PRIVATE_KEY = OTHER_KEY;
    const forged = await signCapsule(capsule());
    process.env.ATTESTATION_PRIVATE_KEY = KEY;

    const r = await verifyCapsule(forged, {
      now: NOW + 1,
      parameters: params,
      isNonceUsed: never,
    });
    expect(r.code).toBe('WRONG_ATTESTOR');
  });

  it('rejects a tampered field even with a valid-looking signature', async () => {
    const signed = await signCapsule(capsule());
    const tampered = {
      ...signed,
      capsule: { ...signed.capsule, policyVersion: 99 },
    };
    const r = await verifyCapsule(tampered, {
      now: NOW + 1,
      parameters: params,
      isNonceUsed: never,
    });
    expect(r.code).toBe('WRONG_ATTESTOR');
  });

  it('refuses to treat a DENY capsule as permission', async () => {
    const signed = await signCapsule(
      capsule({ decision: 'DENY', reasonCode: 'PERMISSION_DENIED' }),
    );
    const r = await verifyCapsule(signed, { now: NOW + 1, parameters: params, isNonceUsed: never });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses to treat a REQUIRE_APPROVAL capsule as permission', async () => {
    const signed = await signCapsule(
      capsule({ decision: 'REQUIRE_APPROVAL', reasonCode: 'APPROVAL_REQUIRED_RISK' }),
    );
    const r = await verifyCapsule(signed, { now: NOW + 1, parameters: params, isNonceUsed: never });
    expect(r.code).toBe('NOT_AUTHORIZED');
  });

  it('rejects a structurally invalid capsule', async () => {
    const r = await verifyCapsule(
      { capsule: { nope: true }, signature: '0x00' },
      { now: NOW, parameters: params, isNonceUsed: never },
    );
    expect(r.code).toBe('MALFORMED_CAPSULE');
  });

  it('rejects a garbage signature', async () => {
    const r = await verifyCapsule(
      { capsule: capsule(), signature: '0xdeadbeef' },
      { now: NOW + 1, parameters: params, isNonceUsed: never },
    );
    expect(['BAD_SIGNATURE', 'WRONG_ATTESTOR']).toContain(r.code);
  });
});
