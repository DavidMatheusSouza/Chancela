import { hashDecision } from '@chancela/shared';
import type { DecisionRow, Repository } from './repository';

/**
 * Find a decision by any of the three ids a reader might be holding -- the
 * decision id, the decision hash or the audit id -- since all three appear in
 * the UI, in the SDK's errors and on the chain.
 */
export async function findDecision(repo: Repository, id: string): Promise<DecisionRow | null> {
  return (
    (await repo.getDecision(id)) ??
    (await repo.getDecisionByHash(id)) ??
    (await repo.listDecisions({ limit: 500 })).find((d) => d.auditId === id) ??
    null
  );
}

/**
 * The decision hash, recomputed from the capsule's own fields with the same
 * function the policy engine used. `hashDecision` commits to this exact subset
 * -- hashing the whole capsule would not reproduce it, since the capsule
 * carries the hash. If the result ever differs from the stored hash, the
 * record has been tampered with and the proof is void.
 */
export function recomputeDecisionHash(decision: DecisionRow): string {
  const c = decision.capsule;
  return hashDecision({
    agentId: c.agentId,
    action: c.action,
    decision: c.decision,
    risk: c.risk,
    reasonCode: c.reasonCode,
    intentHash: c.intentHash,
    policyHash: c.policyHash,
    policyVersion: c.policyVersion,
    nonce: c.nonce,
    issuedAt: c.issuedAt,
  });
}
