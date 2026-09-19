import { getRepository } from '@/lib/store';
import { ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const url = new URL(request.url);
  const repo = await getRepository();
  const decisions = await repo.listDecisions({
    agentId: params.id,
    outcome: (url.searchParams.get('decision') as never) ?? undefined,
    risk: (url.searchParams.get('risk') as never) ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: Number(url.searchParams.get('limit') ?? 100),
  });
  return ok({ events: decisions.map(toAuditEvent) });
}

function toAuditEvent(d: {
  auditId: string;
  createdAt: string;
  agentId: string;
  action: string;
  outcome: string;
  risk: string;
  reasonCode: string;
  policyVersion: number;
  policyHash: string;
  decisionHash: string;
  anchorStatus: string;
  onchainTxHash?: string;
}) {
  return {
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
  };
}
