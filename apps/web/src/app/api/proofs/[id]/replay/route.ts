import { getRepository } from '@/lib/store';
import { findDecision, inputsArePublic, replayDecision } from '@/lib/proof';
import { explorerTxUrl } from '@/lib/chain';
import { fail, ok, rateLimitCaller } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/proofs/:id/replay
 *
 * Everything the policy engine was given for one decision, so the reader can
 * run the engine on their own machine (`npx chancela-check replay <id>`) and
 * see whether it produces the decision hash the attestor signed and Monad
 * recorded. The server's own re-run is included for convenience and is worth
 * nothing as evidence; the bundle is the evidence.
 *
 * Public only for the shared demo account's agents. For anyone else the bundle
 * contains their parameters, and it went to them in the authorize response.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!rateLimitCaller(request, 'proof-replay', 60, 600)) {
    return fail(429, 'RATE_LIMITED', 'Too many replay requests');
  }

  const repo = await getRepository();
  const decision = await findDecision(repo, decodeURIComponent(params.id));
  if (!decision) return fail(404, 'NOT_FOUND', `No decision ${params.id}`);

  const agent = await repo.getAgent(decision.agentId);
  if (!inputsArePublic(agent?.ownerAddress)) {
    return fail(
      403,
      'INPUTS_PRIVATE',
      'This agent is not a public demo agent, so its parameters are not served here. Whoever asked for the decision received the same bundle in the authorize response.',
    );
  }

  const verdict = replayDecision(decision);
  if (!decision.inputs || !verdict) {
    return fail(404, 'INPUTS_NOT_RECORDED', 'This decision was taken before inputs were recorded, so it cannot be replayed.');
  }

  return ok({
    auditId: decision.auditId,
    agentId: decision.agentId,
    decisionHash: decision.decisionHash,
    intentHash: decision.intentHash,
    policyHash: decision.policyHash,
    signature: decision.signature,
    capsule: decision.capsule,
    bundle: decision.inputs,
    anchor: {
      status: decision.anchorStatus,
      txHash: decision.onchainTxHash ?? null,
      blockNumber: decision.blockNumber ?? null,
      explorerUrl: decision.onchainTxHash ? explorerTxUrl(decision.onchainTxHash) : null,
    },
    // The service marking its own homework. Run it yourself.
    serverReplay: {
      ok: verdict.ok,
      mismatch: verdict.mismatch ?? null,
      decision: verdict.result?.decision ?? null,
      reasonCode: verdict.result?.reasonCode ?? null,
      decisionHash: verdict.result?.decisionHash ?? null,
    },
  });
}
