import { getRepository } from '@/lib/store';
import { computeTrustScore } from '@/lib/trust-score';
import { fail, ok } from '@/lib/http';
import { noteReactivation } from '@/lib/breaker';
import { requireOwner } from '@/lib/owner';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { bindMessage } from '@/lib/bind-message';
import { SHARED_DEMO_REFUSAL, isSharedDemoOwner } from '@/lib/demo-signin';
import { onchainAgentWallet } from '@/lib/chain';

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

  // The registry's own record of the wallet, so a caller can check the bound
  // address against the chain without taking this service's word for it.
  const registryWallet =
    agent.erc8004TokenId && agent.walletAddress ? await onchainAgentWallet(agent.erc8004TokenId) : null;

  // The approver passkey's public key is public by nature; publishing it is what
  // lets the on-chain owner register exactly this key (scripts/set-approver.ts).
  const approverKey = await repo.getApproverKey(agent.ownerAddress);

  return ok({
    agent,
    approver: approverKey ? { x: approverKey.publicKeyX, y: approverKey.publicKeyY } : null,
    wallet: agent.walletAddress
      ? {
          address: agent.walletAddress,
          registry: registryWallet,
          inRegistry:
            registryWallet === null ? null : registryWallet.toLowerCase() === agent.walletAddress.toLowerCase(),
        }
      : null,
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

  const body = (await req.json().catch(() => ({}))) as {
    status?: string;
    walletAddress?: string;
    signature?: string;
  };
  if (body.status && !['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(body.status)) {
    return fail(400, 'INVALID_STATUS', 'status must be ACTIVE, SUSPENDED or REVOKED');
  }

  // The shared demo owner may suspend and reactivate -- the breaker demo needs
  // both -- but not the writes that would outlast the visit. See isSharedDemoOwner.
  if (isSharedDemoOwner(guard.session.address)) {
    if (body.status === 'REVOKED') {
      return fail(403, 'SHARED_DEMO_ACCOUNT', `Revoking is permanent, so it is switched off here. ${SHARED_DEMO_REFUSAL}`);
    }
    if (body.walletAddress !== undefined && guard.agent.walletProvider === 'MERA') {
      return fail(403, 'SHARED_DEMO_ACCOUNT', `This agent already has a passkey-derived key bound. ${SHARED_DEMO_REFUSAL}`);
    }
  }

  /*
   * Binding a wallet requires proof of possession. Ownership says the caller
   * may change this agent; it does not say the address they typed is one they
   * control. The derived key signs a message naming both the address and the
   * agent, so a signature lifted from one binding cannot be replayed onto
   * another agent or another address.
   */
  let wallet: { walletAddress: string; walletProvider: 'MERA' } | undefined;
  if (body.walletAddress !== undefined) {
    if (!isAddress(body.walletAddress) || !body.signature) {
      return fail(400, 'INVALID_WALLET', 'walletAddress and signature are required together');
    }
    const valid = await verifyMessage({
      address: getAddress(body.walletAddress),
      message: bindMessage(params.id, body.walletAddress),
      signature: body.signature as `0x${string}`,
    }).catch(() => false);
    if (!valid) {
      return fail(403, 'NOT_THE_KEY_HOLDER', 'The signature does not come from that address.');
    }
    wallet = { walletAddress: getAddress(body.walletAddress), walletProvider: 'MERA' };
  }

  const repo = await getRepository();
  const updated = await repo.updateAgent(params.id, {
    status: body.status as 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | undefined,
    ...wallet,
  });
  if (!updated) return fail(404, 'NOT_FOUND', `Unknown agent ${params.id}`);
  // The owner has looked and said carry on: earlier refusals stop counting.
  if (body.status === 'ACTIVE') noteReactivation(params.id);
  return ok({ agent: updated });
}
