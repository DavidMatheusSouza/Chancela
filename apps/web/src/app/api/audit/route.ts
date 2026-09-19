import { getRepository } from '@/lib/store';
import { ok } from '@/lib/http';
import { explorerTxUrl } from '@/lib/chain';

export const dynamic = 'force-dynamic';

/** Global audit trail across every agent, with filters. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const repo = await getRepository();
  const decisions = await repo.listDecisions({
    agentId: url.searchParams.get('agent') ?? undefined,
    outcome: (url.searchParams.get('decision') as never) ?? undefined,
    risk: (url.searchParams.get('risk') as never) ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: Number(url.searchParams.get('limit') ?? 200),
  });

  return ok({
    events: decisions.map((d) => ({
      auditId: d.auditId,
      time: d.createdAt,
      agentId: d.agentId,
      action: d.action,
      decision: d.outcome,
      risk: d.risk,
      reasonCode: d.reasonCode,
      policyVersion: d.policyVersion,
      policyHash: d.policyHash,
      proof: d.decisionHash,
      anchorStatus: d.anchorStatus,
      txHash: d.onchainTxHash ?? null,
      explorerUrl: d.onchainTxHash ? explorerTxUrl(d.onchainTxHash) : null,
    })),
  });
}
