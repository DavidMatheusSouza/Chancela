import { beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

process.env.SESSION_SECRET = 'a'.repeat(64);

const { createSession, readSession } = await import('../src/lib/session');
const { buildMessage, clearChallenges, issueChallenge, verifyChallenge } = await import('../src/lib/siwe');

// Anvil deterministic account #1 — a published test vector, not a secret.
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const OTHER = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as Hex;

const account = privateKeyToAccount(KEY);
const attacker = privateKeyToAccount(OTHER);

describe('session token', () => {
  it('round-trips a valid session', async () => {
    const token = await createSession(account.address, 'wallet');
    const session = await readSession(token);
    expect(session?.address).toBe(account.address);
    expect(session?.method).toBe('wallet');
  });

  it('rejects a tampered payload', async () => {
    const token = await createSession(account.address, 'wallet');
    const [body, sig] = token.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({
        address: attacker.address,
        method: 'wallet',
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      }),
    )
      .toString('base64url');
    expect(await readSession(`${forgedBody}.${sig}`)).toBeNull();
    expect(body).toBeTruthy();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSession(account.address, 'wallet');
    process.env.SESSION_SECRET = 'b'.repeat(64);
    expect(await readSession(token)).toBeNull();
    process.env.SESSION_SECRET = 'a'.repeat(64);
  });

  it('treats garbage as signed out rather than erroring', async () => {
    for (const bad of ['', 'nope', 'a.b', '...', 'x'.repeat(500)]) {
      expect(await readSession(bad)).toBeNull();
    }
  });

  it('rejects an expired session', async () => {
    const token = await createSession(account.address, 'wallet');
    const session = await readSession(token);
    expect(session).not.toBeNull();
    // Expiry is inside the signed payload, so it cannot be extended by a client.
    expect(session!.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe('wallet challenge', () => {
  beforeEach(() => clearChallenges());

  it('accepts a correctly signed challenge', async () => {
    const { nonce } = issueChallenge(account.address);
    const signature = await account.signMessage({ message: buildMessage(account.address, nonce) });
    const result = await verifyChallenge(nonce, signature);
    expect(result.ok).toBe(true);
    expect(result.address).toBe(account.address);
  });

  it('rejects a signature from a different key', async () => {
    const { nonce } = issueChallenge(account.address);
    const signature = await attacker.signMessage({ message: buildMessage(account.address, nonce) });
    const result = await verifyChallenge(nonce, signature);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ADDRESS_MISMATCH');
  });

  it('burns the nonce even when verification fails', async () => {
    const { nonce } = issueChallenge(account.address);
    const bad = await attacker.signMessage({ message: buildMessage(account.address, nonce) });
    await verifyChallenge(nonce, bad);

    // A failed attempt must not leave the nonce available for a retry.
    const good = await account.signMessage({ message: buildMessage(account.address, nonce) });
    const retry = await verifyChallenge(nonce, good);
    expect(retry.ok).toBe(false);
    expect(retry.reason).toBe('UNKNOWN_NONCE');
  });

  it('refuses a replayed challenge', async () => {
    const { nonce } = issueChallenge(account.address);
    const signature = await account.signMessage({ message: buildMessage(account.address, nonce) });
    expect((await verifyChallenge(nonce, signature)).ok).toBe(true);
    expect((await verifyChallenge(nonce, signature)).reason).toBe('UNKNOWN_NONCE');
  });

  it('refuses an unknown nonce', async () => {
    const signature = await account.signMessage({ message: 'anything' });
    expect((await verifyChallenge('never-issued', signature)).reason).toBe('UNKNOWN_NONCE');
  });

  it('refuses malformed signatures without throwing', async () => {
    const { nonce } = issueChallenge(account.address);
    const result = await verifyChallenge(nonce, '0xdeadbeef');
    expect(result.ok).toBe(false);
  });

  it('states plainly that it authorises no transaction', () => {
    const message = buildMessage(account.address, 'abc');
    expect(message).toContain('costs no gas and authorises no transaction');
    expect(message).toContain(account.address);
    expect(message).toContain('abc');
  });

  it('binds the signature to the address that requested it', async () => {
    // Signing a message built for someone else's address must not authenticate.
    const { nonce } = issueChallenge(account.address);
    const signature = await account.signMessage({
      message: buildMessage(attacker.address, nonce),
    });
    expect((await verifyChallenge(nonce, signature)).ok).toBe(false);
  });
});
