import {
  canonicalJSON,
  capsuleSchema,
  hashIntent,
  type AuthorizationCapsule,
  type Hex,
  type SignedCapsule,
} from '@chancela/shared';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverMessageAddress, isAddressEqual, type Address } from 'viem';

/**
 * Capsule attestation.
 *
 * The attestation key signs decisions. It must never be the agent's operating
 * wallet key: an agent that can sign its own authorizations proves nothing.
 * TrustAgentPolicyRegistry.setAttestor() enforces the same separation on-chain.
 */

export class AttestationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'AttestationError';
  }
}

function getAttestationKey(): Hex {
  const key = process.env.ATTESTATION_PRIVATE_KEY;
  if (!key) {
    throw new AttestationError(
      'ATTESTATION_PRIVATE_KEY is not set. Generate one with: cast wallet new',
      'ATTESTOR_UNCONFIGURED',
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new AttestationError('ATTESTATION_PRIVATE_KEY must be 32 bytes of hex', 'ATTESTOR_MALFORMED');
  }
  return key as Hex;
}

export function attestationAddress(): Address {
  return privateKeyToAccount(getAttestationKey()).address;
}

/** Bytes that get signed. Canonical so the verifier reproduces them exactly. */
export function capsulePayload(capsule: AuthorizationCapsule): string {
  return canonicalJSON(capsule);
}

export async function signCapsule(capsule: AuthorizationCapsule): Promise<SignedCapsule> {
  const account = privateKeyToAccount(getAttestationKey());
  const signature = await account.signMessage({ message: capsulePayload(capsule) });
  return { capsule, signature: signature as Hex, attestationAddress: account.address };
}

export interface VerifyOptions {
  /** Epoch seconds. Injected so expiry is testable. */
  now: number;
  /** The parameters the executor is actually about to use. */
  parameters: Record<string, unknown>;
  /** Returns true if this nonce was already redeemed. */
  isNonceUsed: (nonce: string) => Promise<boolean> | boolean;
  expectedAttestor?: Address;
}

export interface VerifyResult {
  ok: boolean;
  code:
    | 'OK'
    | 'MALFORMED_CAPSULE'
    | 'BAD_SIGNATURE'
    | 'WRONG_ATTESTOR'
    | 'EXPIRED'
    | 'NOT_YET_VALID'
    | 'REPLAYED'
    | 'INTENT_MISMATCH'
    | 'NOT_AUTHORIZED';
  detail?: string;
}

/**
 * Everything the tool executor checks before it is allowed to act.
 *
 * Order matters: cheap structural checks first, signature recovery last, so a
 * malformed capsule never costs an elliptic-curve operation.
 */
export async function verifyCapsule(
  signed: { capsule: unknown; signature: string },
  options: VerifyOptions,
): Promise<VerifyResult> {
  const parsed = capsuleSchema.safeParse(signed.capsule);
  if (!parsed.success) {
    return { ok: false, code: 'MALFORMED_CAPSULE', detail: parsed.error.issues[0]?.message };
  }
  const capsule = parsed.data as AuthorizationCapsule;

  // A DENY capsule is a valid, signed artefact -- it just is not permission.
  if (capsule.decision !== 'ALLOW') {
    return { ok: false, code: 'NOT_AUTHORIZED', detail: capsule.reasonCode };
  }

  if (capsule.issuedAt > options.now + 5) {
    return { ok: false, code: 'NOT_YET_VALID' };
  }
  if (capsule.expiresAt <= options.now) {
    return { ok: false, code: 'EXPIRED', detail: `expired at ${capsule.expiresAt}` };
  }

  // Rebind the decision to the parameters actually being executed. This is the
  // check that closes the gap between "the model proposed X" and "the tool ran Y".
  const recomputed = hashIntent({
    agentId: capsule.agentId,
    action: capsule.action,
    parameters: options.parameters,
  });
  if (recomputed !== capsule.intentHash) {
    return {
      ok: false,
      code: 'INTENT_MISMATCH',
      detail: `expected ${capsule.intentHash}, parameters hash to ${recomputed}`,
    };
  }

  if (await options.isNonceUsed(capsule.nonce)) {
    return { ok: false, code: 'REPLAYED', detail: capsule.nonce };
  }

  let recovered: Address;
  try {
    recovered = await recoverMessageAddress({
      message: capsulePayload(capsule),
      signature: signed.signature as Hex,
    });
  } catch {
    return { ok: false, code: 'BAD_SIGNATURE' };
  }

  const expected = options.expectedAttestor ?? safeAttestationAddress();
  if (!expected) return { ok: false, code: 'WRONG_ATTESTOR', detail: 'no attestor configured' };
  if (!isAddressEqual(recovered, expected)) {
    return { ok: false, code: 'WRONG_ATTESTOR', detail: `signed by ${recovered}` };
  }

  return { ok: true, code: 'OK' };
}

function safeAttestationAddress(): Address | undefined {
  try {
    return attestationAddress();
  } catch {
    return undefined;
  }
}
