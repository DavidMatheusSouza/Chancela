import { getRepository } from '@/lib/store';
import { computeTrustScore } from '@/lib/trust-score';
import { fail, ok } from '@/lib/http';
import { noteReactivation } from '@/lib/breaker';
import { requireOwner } from '@/lib/owner';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const repo = await getRepository();
  const agent = await repo.getAgent(params.id);
  if (!agent) return fail(404, 'NOT_FOUND', `Unknown agent ${params.id}`);

  const policy = await repo.getActivePolicy(params.id);
  const decisions = await repo.listDecisions({ agentId: params.id, limit: 200 });

  const trust = computeTrustScore({
    hasVerifiedOwner: Boolean(agent.erc8004TokenId),
    policyVersion: policy?.version ?? 1,
    decisions,
  });

  return ok({
    agent,
    policy: policy
      ? {
          id: policy.id,
          version: policy.version,
          policyHash: policy.policyHash,
          document: policy.document,
          onchainTxHash: policy.onchainTxHash,
        }
      : null,
    trustScore: trust,
    stats: {
      total: decisions.length,
      allowed: decisions.filter((d) => d.outcome === 'ALLOW').length,
      denied: decisions.filter((d) => d.outcome === 'DENY').length,
      pendingApproval: decisions.filter((d) => d.outcome === 'REQUIRE_APPROVAL').length,
    },
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // Suspending, reactivating and revoking belong to the owner alone.
  const guard = await requireOwner(params.id);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as { status?: string };
  if (body.status && !['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(body.status)) {
    return fail(400, 'INVALID_STATUS', 'status must be ACTIVE, SUSPENDED or REVOKED');
  }
  const repo = await getRepository();
  const updated = await repo.updateAgent(params.id, {
    status: body.status as 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | undefined,
  });
  if (!updated) return fail(404, 'NOT_FOUND', `Unknown agent ${params.id}`);
  // The owner has looked and said carry on: earlier refusals stop counting.
  if (body.status === 'ACTIVE') noteReactivation(params.id);
  return ok({ agent: updated });
}
