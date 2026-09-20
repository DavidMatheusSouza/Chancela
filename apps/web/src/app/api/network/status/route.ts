import { anchorBudget, anchorBudgetLimits } from '@/lib/anchor-budget';
import { activeChain, attestorFunds, chainConfig, identityRegistryAddress, publicClient } from '@/lib/chain';
import { ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Blockchain health, separate from service health.
 *
 * `/api/health` answers "is this service up". This answers "can it still
 * prove anything" -- the RPC may be unreachable or the attestor unfunded while
 * the app itself looks perfectly healthy. Reported as observed, never assumed:
 * the block number and balance are read live, and a failure is returned as a
 * failure rather than smoothed over.
 */
export async function GET() {
  const chain = activeChain();
  const config = chainConfig();

  const base = {
    chain: { id: chain.id, name: chain.name },
    rpcUrl: config?.rpcUrl ?? chain.rpcUrls.default.http[0],
    explorer: chain.blockExplorers.default.url,
    policyRegistry: config?.registryAddress ?? null,
    identityRegistry: identityRegistryAddress() ?? null,
  };

  if (!config) {
    return ok({ ...base, reachable: false, reason: 'No registry configured for this chain' });
  }

  try {
    const client = publicClient();
    const [blockNumber, registryCode, funds] = await Promise.all([
      client.getBlockNumber(),
      client.getBytecode({ address: config.registryAddress as `0x${string}` }),
      // "Low" is less than one day of the anchor budget: time to top up.
      attestorFunds(anchorBudgetLimits().perDay),
    ]);

    return ok({
      ...base,
      reachable: true,
      blockNumber: blockNumber.toString(),
      // A configured address that holds no code would make every proof link a
      // dead end, so it is checked rather than trusted.
      registryDeployed: Boolean(registryCode && registryCode !== '0x'),
      // An empty attestation key fails quietly: decisions keep being made and
      // every anchor turns FAILED. The address and balance are public already;
      // what is added is how many anchors they still buy.
      attestorFunds: funds,
      anchorBudget: anchorBudget.usage(),
    });
  } catch (err) {
    return ok({ ...base, reachable: false, reason: (err as Error).message });
  }
}
