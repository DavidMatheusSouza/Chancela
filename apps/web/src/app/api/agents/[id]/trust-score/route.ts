import { getRepository } from '@/lib/store';
import { computeTrustScore } from '@/lib/trust-score';
import { fail, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const repo = await getRepository();
  const agent = await repo.getAgent(params.id);
  if (!agent) return fail(404, 'NOT_FOUND', `Unknown agent ${params.id}`);
  const policy = await repo.getActivePolicy(params.id);
  const decisions = await repo.listDecisions({ agentId: params.id, limit: 200 });
  return ok(
    computeTrustScore({
      hasVerifiedOwner: Boolean(agent.erc8004TokenId),
      policyVersion: policy?.version ?? 1,
      decisions,
    }),
  );
}
