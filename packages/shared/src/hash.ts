import { keccak256, toHex } from 'viem';
import { canonicalJSON } from './canonical';
import type { Hex } from './types';

/** keccak256 over the canonical JSON encoding of `value`. */
export function hashObject(value: unknown): Hex {
  return keccak256(toHex(canonicalJSON(value))) as Hex;
}

/** keccak256 over a raw UTF-8 string. */
export function hashString(value: string): Hex {
  return keccak256(toHex(value)) as Hex;
}

/**
 * Policy hash -- anchored on-chain and copied onto every decision.
 *
 * Only the fields that actually govern authorisation are hashed. Cosmetic
 * fields (description, UI ordering) are excluded on purpose: renaming a policy
 * must not invalidate the proofs of decisions taken under it.
 */
export function hashPolicyDocument(doc: {
  agentId: string;
  version: number;
  permissions: readonly string[];
  limits: Record<string, number>;
  stepUpThreshold: string;
  environment?: Record<string, unknown>;
}): Hex {
  return hashObject({
    agentId: doc.agentId,
    version: doc.version,
    // Sorted + de-duplicated so that permission ordering is not part of the hash.
    permissions: [...new Set(doc.permissions)].sort(),
    limits: doc.limits,
    stepUpThreshold: doc.stepUpThreshold,
    environment: doc.environment ?? {},
  });
}

/**
 * Intent hash -- binds a decision to the exact parameters it was taken over.
 *
 * The tool executor recomputes this from the parameters it is about to use. If
 * anything changed between decision and execution, the hashes differ and the
 * call is refused. This is what closes the LLM -> tool gap.
 */
export function hashIntent(intent: {
  agentId: string;
  action: string;
  parameters: Record<string, unknown>;
}): Hex {
  return hashObject({
    agentId: intent.agentId,
    action: intent.action,
    parameters: intent.parameters,
  });
}

/** Decision hash -- the identifier recorded on Monad. */
export function hashDecision(decision: {
  agentId: string;
  action: string;
  decision: string;
  risk: string;
  reasonCode: string;
  intentHash: Hex;
  policyHash: Hex;
  policyVersion: number;
  nonce: string;
  issuedAt: number;
}): Hex {
  return hashObject(decision);
}
