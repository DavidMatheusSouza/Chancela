import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import type { Hex } from 'viem';

/**
 * Passkey approvals: the WebAuthn half.
 *
 * An owner approves one step-up decision by signing a WebAuthn assertion whose
 * challenge is that decision's hash. This module checks the assertion on the
 * server, and reshapes it for ChancelaApprovals, which checks it again on Monad
 * with the native P-256 precompile. The two verifiers are deliberately the same
 * list of checks, so "approved" here and "verified on-chain" cannot mean
 * different things.
 *
 * Pure apart from node:crypto, and free of the request and the store, so every
 * way of forging an approval has a unit test.
 */

export interface ApproverPublicKey {
  x: Hex;
  y: Hex;
}

/** As the browser returns it, base64url-encoded for transport. */
export interface AssertionPayload {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export type ApprovalVerdict =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'MALFORMED'
        | 'NOT_AN_ASSERTION'
        | 'CHALLENGE_MISMATCH'
        | 'WRONG_ORIGIN'
        | 'WRONG_RELYING_PARTY'
        | 'USER_NOT_VERIFIED'
        | 'WRONG_CREDENTIAL'
        | 'BAD_SIGNATURE';
    };

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export const fromBase64Url = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64url'));
export const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const sha256 = (bytes: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(bytes).digest());
const hexToBytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
const bytesToHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

/** The challenge an approval of `decisionHash` must carry. */
export function challengeFor(decisionHash: Hex): string {
  return toBase64Url(hexToBytes(decisionHash));
}

/**
 * Read the P-256 point out of the SubjectPublicKeyInfo the browser hands over
 * at registration (`AuthenticatorAttestationResponse.getPublicKey()`). Throws
 * on anything that is not an uncompressed P-256 key.
 */
export function publicKeyFromSpki(spki: Uint8Array): ApproverPublicKey {
  const jwk = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' }).export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('The passkey is not an ES256 (P-256) key');
  }
  return { x: bytesToHex(fromBase64Url(jwk.x)), y: bytesToHex(fromBase64Url(jwk.y)) };
}

export function verifyApproval(input: {
  assertion: AssertionPayload;
  decisionHash: Hex;
  publicKey: ApproverPublicKey;
  credentialId: string;
  rpId: string;
  origins: readonly string[];
}): ApprovalVerdict {
  let authenticatorData: Uint8Array;
  let clientDataBytes: Uint8Array;
  let signature: Uint8Array;
  let clientData: { type?: unknown; challenge?: unknown; origin?: unknown };
  try {
    authenticatorData = fromBase64Url(input.assertion.authenticatorData);
    clientDataBytes = fromBase64Url(input.assertion.clientDataJSON);
    signature = fromBase64Url(input.assertion.signature);
    clientData = JSON.parse(Buffer.from(clientDataBytes).toString('utf8'));
  } catch {
    return { ok: false, code: 'MALFORMED' };
  }
  if (authenticatorData.length < 37 || signature.length === 0) return { ok: false, code: 'MALFORMED' };

  if (input.assertion.credentialId !== input.credentialId) return { ok: false, code: 'WRONG_CREDENTIAL' };
  if (clientData.type !== 'webauthn.get') return { ok: false, code: 'NOT_AN_ASSERTION' };
  if (clientData.challenge !== challengeFor(input.decisionHash)) return { ok: false, code: 'CHALLENGE_MISMATCH' };
  if (typeof clientData.origin !== 'string' || !input.origins.includes(clientData.origin)) {
    return { ok: false, code: 'WRONG_ORIGIN' };
  }

  const rpIdHash = sha256(new TextEncoder().encode(input.rpId));
  if (!Buffer.from(authenticatorData.subarray(0, 32)).equals(Buffer.from(rpIdHash))) {
    return { ok: false, code: 'WRONG_RELYING_PARTY' };
  }
  // flags: bit 0 user present, bit 2 user verified. Both, or it is not an approval.
  if ((authenticatorData[32]! & 0x05) !== 0x05) return { ok: false, code: 'USER_NOT_VERIFIED' };

  try {
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: toBase64Url(hexToBytes(input.publicKey.x)),
        y: toBase64Url(hexToBytes(input.publicKey.y)),
      },
      format: 'jwk',
    });
    const signed = Buffer.concat([Buffer.from(authenticatorData), Buffer.from(sha256(clientDataBytes))]);
    const valid = verifySignature('sha256', signed, { key, dsaEncoding: 'der' }, Buffer.from(signature));
    return valid ? { ok: true } : { ok: false, code: 'BAD_SIGNATURE' };
  } catch {
    return { ok: false, code: 'BAD_SIGNATURE' };
  }
}

/** DER ECDSA signature -> fixed-width r and s. */
function derToRs(der: Uint8Array): { r: bigint; s: bigint } {
  let offset = 0;
  const expect = (tag: number) => {
    if (der[offset++] !== tag) throw new Error('Malformed DER signature');
  };
  const length = () => {
    let len = der[offset++]!;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[offset++]!;
    }
    return len;
  };
  const integer = () => {
    expect(0x02);
    const len = length();
    const value = BigInt(`0x${Buffer.from(der.subarray(offset, offset + len)).toString('hex') || '0'}`);
    offset += len;
    return value;
  };
  expect(0x30);
  length();
  return { r: integer(), s: integer() };
}

export interface OnchainAssertion {
  authenticatorData: Hex;
  clientDataJSON: string;
  typeIndex: bigint;
  challengeIndex: bigint;
  r: Hex;
  s: Hex;
}

/**
 * The same assertion, in the shape ChancelaApprovals.recordApproval takes.
 *
 * `s` is folded into the lower half of the group order: authenticators emit
 * either form, both verify, and the contract -- like most on-chain verifiers --
 * accepts only the low one so a signature has a single encoding.
 */
export function toOnchainAssertion(assertion: AssertionPayload): OnchainAssertion {
  const clientDataJSON = Buffer.from(fromBase64Url(assertion.clientDataJSON)).toString('utf8');
  const { r, s } = derToRs(fromBase64Url(assertion.signature));
  const lowS = s > P256_N / 2n ? P256_N - s : s;
  const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, '0')}`;
  return {
    authenticatorData: bytesToHex(fromBase64Url(assertion.authenticatorData)),
    clientDataJSON,
    typeIndex: BigInt(clientDataJSON.indexOf('"type":"webauthn.get"')),
    challengeIndex: BigInt(clientDataJSON.indexOf('"challenge":"')),
    r: word(r),
    s: word(lowS),
  };
}
