import { activeChain, identityRegistryAddress } from './chain';
import { fail } from './http';
import { getRepository } from './store';

/**
 * An agent's ERC-8004 registration file.
 *
 * This is what `tokenURI` on the identity registry points at: the registration
 * scripts write `<base>/.well-known/agent-card/<id>.json` on-chain, so without
 * this route the registry's own pointer led nowhere. The shape is the one the
 * ERC gives for `registration-v1`. Nothing in it is private -- it is the public
 * half of `/api/agents/:id`.
 *
 * `supportedTrust` is left empty on purpose: the ERC's values name its own
 * reputation and validation registries, and what vouches for these agents is
 * the policy registry, reachable through the services listed here.
 */
export async function agentCardResponse(request: Request, file: string): Promise<Response> {
  const id = file.replace(/\.json$/i, '');
  const repo = await getRepository();
  const agent = await repo.getAgent(id);
  if (!agent) return fail(404, 'NOT_FOUND', `Unknown agent ${id}`);

  const base = (process.env.PUBLIC_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, '');
  const chainId = activeChain().id;
  const registry = identityRegistryAddress();

  const services: Array<{ name: string; endpoint: string; version?: string }> = [
    { name: 'web', endpoint: `${base}/agents/${agent.id}` },
    { name: 'chancela-authorize', endpoint: `${base}/api/agents/${agent.id}/authorize`, version: 'v1' },
    { name: 'chancela-audit', endpoint: `${base}/api/agents/${agent.id}/audit`, version: 'v1' },
  ];
  if (agent.walletAddress) {
    services.push({ name: 'agentWallet', endpoint: `eip155:${chainId}:${agent.walletAddress}` });
  }

  const card = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: agent.name,
    description: agent.description,
    image: `${base}/icon.svg`,
    services,
    x402Support: false,
    active: agent.status === 'ACTIVE',
    registrations:
      agent.erc8004TokenId && registry
        ? [{ agentId: Number(agent.erc8004TokenId), agentRegistry: `eip155:${chainId}:${registry}` }]
        : [],
    supportedTrust: [] as string[],
  };

  return Response.json(card, {
    headers: {
      // A registry indexer is a script on somebody else's origin.
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=60',
    },
  });
}
