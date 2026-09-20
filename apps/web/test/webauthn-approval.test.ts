import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  challengeFor,
  publicKeyFromSpki,
  toBase64Url,
  toOnchainAssertion,
  verifyApproval,
  type AssertionPayload,
} from '../src/lib/webauthn-approval';

const RP = 'chancela.xyz';
const ORIGIN = 'https://chancela.xyz';
const DECISION = `0x${'5a'.repeat(32)}` as const;
const CRED = 'Y3JlZGVudGlhbC0x';

const passkey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const spki = (k: typeof passkey) => new Uint8Array(k.publicKey.export({ format: 'der', type: 'spki' }));
const sha = (b: Uint8Array | string) => new Uint8Array(createHash('sha256').update(b).digest());

function assertion(over: {
  key?: typeof passkey;
  type?: string;
  challenge?: string;
  origin?: string;
  rpId?: string;
  flags?: number;
} = {}): AssertionPayload {
  const clientData = Buffer.from(
    JSON.stringify({
      type: over.type ?? 'webauthn.get',
      challenge: over.challenge ?? challengeFor(DECISION),
      origin: over.origin ?? ORIGIN,
      crossOrigin: false,
    }),
  );
  const auth = Buffer.concat([Buffer.from(sha(over.rpId ?? RP)), Buffer.from([over.flags ?? 0x05, 0, 0, 0, 3])]);
  const signature = sign('sha256', Buffer.concat([auth, Buffer.from(sha(clientData))]), {
    key: (over.key ?? passkey).privateKey,
    dsaEncoding: 'der',
  });
  return {
    credentialId: CRED,
    authenticatorData: toBase64Url(auth),
    clientDataJSON: toBase64Url(clientData),
    signature: toBase64Url(signature),
  };
}

const check = (a: AssertionPayload, decisionHash: `0x${string}` = DECISION) =>
  verifyApproval({
    assertion: a,
    decisionHash,
    publicKey: publicKeyFromSpki(spki(passkey)),
    credentialId: CRED,
    rpId: RP,
    origins: [ORIGIN],
  });

describe('verifying a passkey approval', () => {
  it('accepts the owner approving exactly this decision', () => {
    expect(check(assertion())).toEqual({ ok: true });
  });

  it.each([
    ['moved to another decision', () => check(assertion(), `0x${'6b'.repeat(32)}`), 'CHALLENGE_MISMATCH'],
    ['signed by another passkey', () => check(assertion({ key: other })), 'BAD_SIGNATURE'],
    ['obtained on another origin', () => check(assertion({ origin: 'https://chancela.xyz.evil.example' })), 'WRONG_ORIGIN'],
    ['made for another relying party', () => check(assertion({ rpId: 'evil.example' })), 'WRONG_RELYING_PARTY'],
    ['given without user verification', () => check(assertion({ flags: 0x01 })), 'USER_NOT_VERIFIED'],
    ['really a registration ceremony', () => check(assertion({ type: 'webauthn.create' })), 'NOT_AN_ASSERTION'],
    ['from a different credential', () => check({ ...assertion(), credentialId: 'b3RoZXI' }), 'WRONG_CREDENTIAL'],
    ['not even parseable', () => check({ ...assertion(), clientDataJSON: '!!!' }), 'MALFORMED'],
  ])('refuses an approval %s', (_name, run, code) => {
    expect(run()).toEqual({ ok: false, code });
  });

  it('refuses client data edited after signing', () => {
    const a = assertion();
    const edited = Buffer.from(a.clientDataJSON, 'base64url').toString().replace('"crossOrigin":false', '"crossOrigin":true ');
    expect(check({ ...a, clientDataJSON: toBase64Url(Buffer.from(edited)) })).toEqual({ ok: false, code: 'BAD_SIGNATURE' });
  });
});

describe('reshaping an assertion for the contract', () => {
  it('points at the type and the challenge, and keeps s in the lower half', () => {
    const HALF = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n / 2n;
    for (let i = 0; i < 12; i++) {
      const o = toOnchainAssertion(assertion());
      expect(o.clientDataJSON.slice(Number(o.typeIndex))).toMatch(/^"type":"webauthn\.get"/);
      expect(o.clientDataJSON.slice(Number(o.challengeIndex))).toMatch(new RegExp(`^"challenge":"${challengeFor(DECISION)}"`));
      expect(o.r).toMatch(/^0x[0-9a-f]{64}$/);
      expect(BigInt(o.s) <= HALF).toBe(true);
      expect(BigInt(o.s) > 0n).toBe(true);
    }
  });

  it('reads the point out of the key the browser hands over', () => {
    const jwk = passkey.publicKey.export({ format: 'jwk' });
    expect(publicKeyFromSpki(spki(passkey))).toEqual({
      x: `0x${Buffer.from(jwk.x!, 'base64url').toString('hex')}`,
      y: `0x${Buffer.from(jwk.y!, 'base64url').toString('hex')}`,
    });
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => publicKeyFromSpki(new Uint8Array(rsa.publicKey.export({ format: 'der', type: 'spki' })))).toThrow(/P-256/);
  });
});
