import {
  hashPolicyDocument,
  type AgentRecord,
  type Hex,
  type PolicyDocument,
  type RiskSignal,
} from '@chancela/shared';
import { evaluate, type EvaluateInput, type EvaluateResult, type UsageWindow } from './evaluate';

/**
 * Everything `evaluate()` was given for one decision, as plain JSON.
 *
 * `evaluate()` reads nothing else -- no clock, no database, no model -- so this
 * is the whole of what the answer depended on. Hand it to anyone and they can
 * run the same function and must arrive at the same decision hash: the one the
 * attestor signed and Monad recorded. If they do not, the attestor signed
 * something its own policy engine does not say, and the bundle is the evidence.
 */
export interface ReplayBundle {
  /** Bumped if the bundle's shape ever changes. */
  bundle: 1;
  agent: AgentRecord;
  policy: PolicyDocument | null;
  policyId: string;
  action: string;
  parameters: Record<string, unknown>;
  riskSignals: RiskSignal[];
  usage: UsageWindow;
  environment: string;
  now: number;
  nonce: string;
  ttlSeconds?: number;
  approval?: { stepUpDecisionHash: Hex };
}

/** The bundle for an evaluation, with the defaults `evaluate()` would apply written out. */
export function bundleOf(input: EvaluateInput): ReplayBundle {
  const bundle: ReplayBundle = {
    bundle: 1,
    agent: input.agent,
    policy: input.policy,
    policyId: input.policyId,
    action: input.action,
    parameters: input.parameters,
    riskSignals: [...(input.riskSignals ?? [])],
    usage: input.usage ?? { transactionsToday: 0, valueMovedToday: 0 },
    environment: input.environment ?? 'production',
    now: input.now,
    nonce: input.nonce,
  };
  if (input.ttlSeconds !== undefined) bundle.ttlSeconds = input.ttlSeconds;
  if (input.approval !== undefined) bundle.approval = input.approval;
  // What is stored and served is JSON, so the bundle is what survives JSON.
  return JSON.parse(JSON.stringify(bundle)) as ReplayBundle;
}

export interface ReplayExpectation {
  /** The hash the attestor signed and the chain recorded. */
  decisionHash: string;
  /** The policy hash anchored for the agent, when the caller has read it from the registry. */
  policyHash?: string;
  /** The intent hash in the signed capsule. */
  intentHash?: string;
}

export interface ReplayVerdict {
  /** True only if every hash that was expected was reproduced. */
  ok: boolean;
  /** Which comparison failed first, for a message a person can act on. */
  mismatch?: 'DECISION_HASH' | 'POLICY_HASH' | 'INTENT_HASH' | 'MALFORMED_BUNDLE';
  /** What the engine said this time. Absent only when the bundle could not be run. */
  result?: EvaluateResult;
}

/**
 * Run the decision again from its bundle and compare.
 *
 * Three things are compared, because a matching decision hash alone would only
 * show the bundle is self-consistent:
 *  - the policy in the bundle hashes to the policy hash the owner anchored;
 *  - the parameters in the bundle hash to the intent hash in the capsule;
 *  - the engine, run on the bundle, produces the signed decision hash.
 */
export function replay(bundle: ReplayBundle, expected: ReplayExpectation): ReplayVerdict {
  if (!isBundle(bundle)) return { ok: false, mismatch: 'MALFORMED_BUNDLE' };

  const result = evaluate({
    agent: bundle.agent,
    policy: bundle.policy,
    policyId: bundle.policyId,
    action: bundle.action,
    parameters: bundle.parameters,
    riskSignals: bundle.riskSignals,
    usage: bundle.usage,
    environment: bundle.environment,
    now: bundle.now,
    nonce: bundle.nonce,
    ttlSeconds: bundle.ttlSeconds,
    approval: bundle.approval,
  });

  // The engine's own policy hash, which is the one the capsule carries: zero
  // when no policy was bound, the document's hash otherwise.
  if (expected.policyHash !== undefined && !sameHash(result.policyHash, expected.policyHash)) {
    return { ok: false, mismatch: 'POLICY_HASH', result };
  }
  if (expected.intentHash !== undefined && !sameHash(result.intentHash, expected.intentHash)) {
    return { ok: false, mismatch: 'INTENT_HASH', result };
  }
  if (!sameHash(result.decisionHash, expected.decisionHash)) {
    return { ok: false, mismatch: 'DECISION_HASH', result };
  }
  return { ok: true, result };
}

/** Enough shape to run the engine on. Anything else is refused, not guessed at. */
function isBundle(value: unknown): value is ReplayBundle {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Partial<ReplayBundle>;
  return (
    b.bundle === 1 &&
    typeof b.agent === 'object' &&
    b.agent !== null &&
    typeof b.agent.id === 'string' &&
    typeof b.action === 'string' &&
    typeof b.parameters === 'object' &&
    b.parameters !== null &&
    typeof b.nonce === 'string' &&
    typeof b.now === 'number'
  );
}

/** The hash of a policy document, as the engine and the registry know it. */
export function policyHashOf(policy: PolicyDocument | null): Hex | undefined {
  if (!policy) return undefined;
  try {
    return hashPolicyDocument({
      agentId: policy.agentId,
      version: policy.version,
      permissions: policy.permissions,
      limits: policy.limits as unknown as Record<string, number>,
      stepUpThreshold: policy.stepUpThreshold,
      environment: policy.environment as unknown as Record<string, unknown>,
    });
  } catch {
    return undefined;
  }
}

function sameHash(a: string | undefined, b: string | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}
