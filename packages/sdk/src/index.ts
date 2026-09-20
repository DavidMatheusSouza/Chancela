import { canonicalJSON, hashIntent } from '@chancela/shared';
import { createPublicClient, http, isAddressEqual, recoverMessageAddress, type Address, type Hex } from 'viem';

/**
 * Chancela client.
 *
 * Two jobs. Ask a deployment whether an agent may act -- and then *not take its
 * word for it*. The answer comes back as a signed capsule, and `verify` checks
 * that capsule locally: signed by the attestor the agent's owner registered
 * on-chain, bound to the exact parameters about to be used, and not expired.
 *
 * That second half is why this is a primitive and not a SaaS call. A compromised
 * or dishonest deployment can refuse to answer, but it cannot forge a permission
 * that passes `verify`, because it does not hold the key the registry names.
 *
 * Failing closed is the rule throughout: no answer, a malformed answer and an
 * unverifiable answer are all "no".
 */

export type Outcome = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface Capsule {
  version: 1;
  agentId: string;
  ownerAddress: string;
  action: string;
  intentHash: Hex;
  policyId: string;
  policyVersion: number;
  policyHash: Hex;
  decision: Outcome;
  risk: string;
  reasonCode: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  decisionHash: Hex;
}

export interface Decision {
  decision: Outcome;
  reasonCode: string;
  reasonText: string;
  risk: string;
  auditId: string;
  policyVersion: number;
  policyHash: Hex;
  decisionHash: Hex;
  capsule: Capsule;
  signature: Hex;
  attestationAddress: Address;
  anchorStatus: string;
}

export type VerifyCode =
  | 'OK'
  | 'NOT_AUTHORIZED'
  | 'MALFORMED'
  | 'WRONG_AGENT_OR_ACTION'
  | 'INTENT_MISMATCH'
  | 'EXPIRED'
  | 'BAD_SIGNATURE'
  | 'WRONG_ATTESTOR';

export interface Verdict {
  ok: boolean;
  code: VerifyCode;
  detail?: string;
}

export class ChancelaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly decision?: Decision,
  ) {
    super(message);
    this.name = 'ChancelaError';
  }
}

export interface ClientOptions {
  /** A Chancela deployment, e.g. https://chancela.xyz -- yours or anyone's. */
  baseUrl: string;
  /**
   * The attestor you expect, or a function that finds it. Use
   * `attestorFromRegistry` to read the one the agent's owner set on-chain.
   * Required for `verify` and `guard`: a signature checked against whatever
   * address the server claims for itself proves nothing.
   */
  attestor?: Address | ((agentId: string) => Promise<Address>);
  fetch?: typeof fetch;
  /** Epoch seconds; injectable so expiry is testable. */
  now?: () => number;
}

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'attestorOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const;

/**
 * Resolve an agent's attestor from the policy registry on Monad.
 *
 * Only the holder of the agent's ERC-8004 identity can set it, so this is the
 * owner's statement of whose signature counts -- read from the chain, not from
 * the service being checked.
 */
export function attestorFromRegistry(options: {
  rpcUrl: string;
  registry: Address;
  /** Maps an agent id to its ERC-8004 token id. */
  tokenId: (agentId: string) => bigint | Promise<bigint>;
}): (agentId: string) => Promise<Address> {
  const client = createPublicClient({ transport: http(options.rpcUrl) });
  return async (agentId) => {
    const attestor = await client.readContract({
      address: options.registry,
      abi: REGISTRY_ABI,
      functionName: 'attestorOf',
      args: [await options.tokenId(agentId)],
    });
    if (/^0x0{40}$/.test(attestor)) {
      throw new ChancelaError('NO_ATTESTOR', `No attestor is registered on-chain for ${agentId}.`);
    }
    return attestor;
  };
}

export function createClient(options: ClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });
    } catch {
      // Unreachable is not permission.
      throw new ChancelaError('UNREACHABLE', `Could not reach Chancela at ${base}. Nothing was authorized.`);
    }
    const body = (await response.json().catch(() => null)) as
      | (T & { error?: { code?: string; message?: string } })
      | null;
    if (!response.ok || body === null) {
      throw new ChancelaError(
        body?.error?.code ?? `HTTP_${response.status}`,
        body?.error?.message ?? `Chancela answered ${response.status}. Nothing was authorized.`,
      );
    }
    return body;
  }

  /** Ask. Returns the decision whatever it is; a DENY is an answer, not an error. */
  async function authorize(
    agentId: string,
    action: string,
    parameters: Record<string, unknown> = {},
  ): Promise<Decision> {
    const decision = await call<Decision>(`/api/agents/${encodeURIComponent(agentId)}/authorize`, {
      method: 'POST',
      body: JSON.stringify({ action, parameters }),
    });
    if (!decision?.capsule || !decision.signature) {
      throw new ChancelaError('MALFORMED', 'The answer carried no signed capsule. Nothing was authorized.');
    }
    return decision;
  }

  /**
   * Check a decision without trusting whoever sent it.
   *
   * Pass the parameters you are *about to use*, not the ones you remember
   * asking about: the capsule commits to their hash, which is what stops
   * anything between the decision and the action from swapping them.
   */
  async function verify(
    decision: Pick<Decision, 'capsule' | 'signature'>,
    expected: { agentId: string; action: string; parameters: Record<string, unknown> },
  ): Promise<Verdict> {
    const capsule = decision.capsule;
    if (!capsule || typeof capsule !== 'object' || typeof decision.signature !== 'string') {
      return { ok: false, code: 'MALFORMED' };
    }
    if (capsule.decision !== 'ALLOW') return { ok: false, code: 'NOT_AUTHORIZED', detail: capsule.reasonCode };
    if (capsule.agentId !== expected.agentId || capsule.action !== expected.action) {
      return { ok: false, code: 'WRONG_AGENT_OR_ACTION', detail: `${capsule.agentId} / ${capsule.action}` };
    }
    const intentHash = hashIntent({
      agentId: expected.agentId,
      action: expected.action,
      parameters: expected.parameters,
    });
    if (intentHash !== capsule.intentHash) return { ok: false, code: 'INTENT_MISMATCH' };
    if (capsule.expiresAt <= now()) return { ok: false, code: 'EXPIRED', detail: `expired at ${capsule.expiresAt}` };

    if (!options.attestor) {
      return { ok: false, code: 'WRONG_ATTESTOR', detail: 'no attestor configured; see attestorFromRegistry' };
    }
    let signer: Address;
    try {
      signer = await recoverMessageAddress({ message: canonicalJSON(capsule), signature: decision.signature });
    } catch {
      return { ok: false, code: 'BAD_SIGNATURE' };
    }
    const attestor =
      typeof options.attestor === 'function' ? await options.attestor(expected.agentId) : options.attestor;
    if (!isAddressEqual(signer, attestor)) {
      return { ok: false, code: 'WRONG_ATTESTOR', detail: `signed by ${signer}, expected ${attestor}` };
    }
    return { ok: true, code: 'OK' };
  }

  /**
   * Run `act` only if the action is allowed *and* the permission verifies.
   * Anything else throws, and `act` is never called.
   *
   *   await chancela.guard('TA-003', 'TRANSFER_FUNDS', { amount, recipientAddress }, () => send(...));
   */
  async function guard<T>(
    agentId: string,
    action: string,
    parameters: Record<string, unknown>,
    act: (decision: Decision) => Promise<T> | T,
  ): Promise<T> {
    const decision = await authorize(agentId, action, parameters);
    if (decision.decision !== 'ALLOW') {
      throw new ChancelaError(
        decision.decision === 'DENY' ? 'DENIED' : 'APPROVAL_REQUIRED',
        `${action} was not authorized: ${decision.reasonText} (${decision.reasonCode}). Audit ${decision.auditId}.`,
        decision,
      );
    }
    const verdict = await verify(decision, { agentId, action, parameters });
    if (!verdict.ok) {
      throw new ChancelaError(
        `UNVERIFIED_${verdict.code}`,
        `The permission for ${action} did not verify (${verdict.code}). Nothing was done.`,
        decision,
      );
    }
    return act(decision);
  }

  /** The public, login-free proof of a decision, including its Monad anchor. */
  const proof = (auditId: string) => call<Record<string, unknown>>(`/api/proofs/${encodeURIComponent(auditId)}`);

  /** The agent's passport: identity, active policy, trust score. */
  const passport = (agentId: string) => call<Record<string, unknown>>(`/api/agents/${encodeURIComponent(agentId)}`);

  return { authorize, verify, guard, proof, passport };
}

export type ChancelaClient = ReturnType<typeof createClient>;
