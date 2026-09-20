import { hashPolicyDocument } from '@chancela/shared';
import { getAddress } from 'viem';
import type { Repository } from './repository';

/**
 * Create an agent and its first policy.
 *
 * The owner is whoever is asking, never a default. Until this was shared code
 * the create route wrote DEMO_OWNER_ADDRESS regardless of who was signed in,
 * so a Privy or passkey user would have made an agent that belonged to someone
 * else -- and then been refused when they tried to edit it.
 *
 * Deny by default applies at creation, not only at evaluation: the agent starts
 * with exactly the permissions it was given, zero limits, and nothing else.
 */
export async function createAgentFor(
  repo: Repository,
  input: { ownerAddress: string; name: string; description?: string; permissions: string[] },
) {
  const owner = getAddress(input.ownerAddress);
  const existing = await repo.listAgents();
  const id = `TA-${String(existing.length + 1).padStart(3, '0')}`;

  // The index is per owner: it selects a key under *their* passkey, so it must
  // not depend on how many agents other people happen to have.
  const mine = existing.filter((a) => getAddress(a.ownerAddress) === owner).length;

  const agent = await repo.createAgent({
    id,
    name: input.name,
    description: input.description,
    ownerAddress: owner,
    status: 'ACTIVE',
    derivationIndex: mine,
    walletProvider: 'MERA',
  });

  const document = {
    agentId: id,
    name: input.name,
    version: 1,
    permissions: input.permissions,
    limits: { maxTransactionValue: 0, dailyTransactions: 0, dailyValueCap: 0 },
    stepUpThreshold: 'HIGH' as const,
    environment: {},
  };

  const policy = await repo.createPolicy({
    id: `pol_${id}_v1`,
    agentId: id,
    name: input.name,
    version: 1,
    policyHash: hashPolicyDocument({
      agentId: id,
      version: 1,
      permissions: document.permissions,
      limits: document.limits as unknown as Record<string, number>,
      stepUpThreshold: document.stepUpThreshold,
      environment: {},
    }),
    document,
    status: 'DRAFT',
  });
  await repo.activatePolicy(policy.id);

  return { agent, policy };
}
