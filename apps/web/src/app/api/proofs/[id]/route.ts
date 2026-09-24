import { getRepository } from '@/lib/store';
import { findDecision, recomputeDecisionHash } from '@/lib/proof';
import { explorerTxUrl } from '@/lib/chain';
import { fail, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * A single decision's proof, resolvable by decision id, decision hash or audit
 * id -- whichever of the three a reader happens to be holding, since all three
 * appear in the UI.
 *
 * The point of this endpoint is independent verification: it returns the
 * capsule and the recomputed decision hash side by side, so a reader can
 * confirm the service is serving the same hash it anchored rather than taking
 * the claim on trust. Only hashes and references leave here -- never the
 * prompt, and never the raw model output.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const repo = await getRepository();

  const decision = await findDecision(repo, params.id);
  if (!decision) return fail(404, 'NOT_FOUND', `No proof for ${params.id}`);

  // Recomputed from the stored capsule on every request, never read back.
  const recomputed = recomputeDecisionHash(decision);

  return ok({
    auditId: decision.auditId,
    decisionId: decision.id,
    agentId: decision.agentId,
    action: decision.action,
    decision: decision.outcome,
    risk: decision.risk,
    reasonCode: decision.reasonCode,
    policy: { version: decision.policyVersion, hash: decision.policyHash },
    intentHash: decision.intentHash,
    decisionHash: decision.decisionHash,
    // Recomputed from the stored capsule on every request. If these two ever
    // disagree, the record has been tampered with and the proof is void.
    recomputedHash: recomputed,
    verified: recomputed === decision.decisionHash,
    signature: decision.signature,
    capsule: decision.capsule,
    anchor: {
      status: decision.anchorStatus,
      txHash: decision.onchainTxHash ?? null,
      blockNumber: decision.blockNumber ?? null,
      explorerUrl: decision.onchainTxHash ? explorerTxUrl(decision.onchainTxHash) : null,
    },
    issuedAt: decision.issuedAt,
    createdAt: decision.createdAt,
  });
}
