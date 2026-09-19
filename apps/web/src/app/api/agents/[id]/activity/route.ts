import { getRepository } from '@/lib/store';
import { ok } from '@/lib/http';
import { explorerTxUrl } from '@/lib/chain';

export const dynamic = 'force-dynamic';

const ENVIO_QUERY = `
  query AgentActivity($agentTokenId: numeric!) {
    DecisionRecorded(where: {agentTokenId: {_eq: $agentTokenId}}, order_by: {ts: desc}, limit: 100) {
      id decisionHash action decision risk policyHash ts blockNumber txHash
    }
  }`;

/**
 * Trust Activity Explorer feed.
 *
 * Prefers the Envio-indexed chain data -- the point of the explorer is that it
 * reads the chain, not our database. Falls back to local decisions when the
 * indexer is not configured, and reports which source it used so the UI never
 * implies on-chain provenance it does not have.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const repo = await getRepository();
  const agent = await repo.getAgent(params.id);
  const endpoint = process.env.ENVIO_GRAPHQL_URL;

  if (endpoint && agent?.erc8004TokenId) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: ENVIO_QUERY,
          variables: { agentTokenId: Number(agent.erc8004TokenId) },
        }),
      });
      if (response.ok) {
        const payload = (await response.json()) as { data?: { DecisionRecorded?: unknown[] } };
        return ok({ source: 'envio', events: payload.data?.DecisionRecorded ?? [] });
      }
    } catch {
      // fall through to the local view
    }
  }

  const decisions = await repo.listDecisions({ agentId: params.id, limit: 100 });
  return ok({
    source: 'local',
    events: decisions.map((d) => ({
      id: d.id,
      decisionHash: d.decisionHash,
      action: d.action,
      decision: d.outcome,
      risk: d.risk,
      policyHash: d.policyHash,
      ts: d.createdAt,
      txHash: d.onchainTxHash ?? null,
      explorerUrl: d.onchainTxHash ? explorerTxUrl(d.onchainTxHash) : null,
      anchorStatus: d.anchorStatus,
    })),
  });
}
