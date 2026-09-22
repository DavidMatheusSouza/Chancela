import { availableProviders } from '@chancela/ai';
import { meraStatus } from '@/lib/mera-status';
import { getRepository } from '@/lib/store';
import { activeChain, chainConfig, identityRegistryAddress } from '@/lib/chain';
import { nansenStatus } from '@/lib/nansen';
import { ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Integration status, reported honestly.
 *
 * Every entry reflects an actual runtime check. Nothing here is hardcoded to
 * "connected" for the sake of a screenshot -- an unconfigured integration says
 * so, and says what is missing.
 */
export async function GET() {
  const mera = await meraStatus(await getRepository());
  const chain = activeChain();
  const config = chainConfig();
  const providers = availableProviders();

  return ok({
    integrations: [
      {
        id: 'monad',
        name: 'Monad',
        role: 'Settlement and proof layer for every authorization decision.',
        status: config ? 'CONNECTED' : 'NOT_CONFIGURED',
        detail: config
          ? `${chain.name} (chainId ${chain.id})`
          : 'Set POLICY_REGISTRY_ADDRESS and ATTESTATION_PRIVATE_KEY',
        docs: 'https://docs.monad.xyz/developer-essentials/network-information',
      },
      {
        id: 'erc8004',
        name: 'ERC-8004 Identity Registry',
        role: 'Agent identity. Chancela binds to it rather than re-implementing it.',
        status: identityRegistryAddress() ? 'CONNECTED' : 'NOT_CONFIGURED',
        detail: identityRegistryAddress() ?? 'No registry address for this chain',
        docs: 'https://docs.monad.xyz/guides/erc-8004',
      },
      {
        id: 'privy',
        name: 'Privy',
        role: 'Owner authentication and server wallets; key-level policy mirror.',
        status: process.env.NEXT_PUBLIC_PRIVY_APP_ID ? 'CONNECTED' : 'NOT_CONFIGURED',
        detail: process.env.NEXT_PUBLIC_PRIVY_APP_ID ? 'App configured' : 'Set NEXT_PUBLIC_PRIVY_APP_ID',
        docs: 'https://docs.privy.io',
      },
      {
        id: 'mera',
        name: 'mera (Monad)',
        role: 'One owner passkey derives one BIP-44 key per agent. No seed phrase.',
        ...mera,
        docs: 'https://www.monad.xyz/blog/introducing-mera',
      },
      {
        id: 'envio',
        name: 'Envio HyperIndex',
        role: 'Indexes registry events into GraphQL for the Trust Activity Explorer.',
        status: process.env.ENVIO_GRAPHQL_URL ? 'CONNECTED' : 'NOT_CONFIGURED',
        detail: process.env.ENVIO_GRAPHQL_URL ?? 'Set ENVIO_GRAPHQL_URL',
        docs: 'https://docs.envio.dev',
      },
      {
        id: 'nansen',
        name: 'Nansen',
        role: 'Counterparty labels feed the risk engine. Never grants permission.',
        ...nansenStatus(),
        docs: 'https://docs.nansen.ai',
      },
      ...providers.map((p) => ({
        id: `ai-${p.id}`,
        name: p.id === 'rules' ? 'Deterministic parser' : p.id.toUpperCase(),
        role: 'Intent extraction. Holds no authority over any decision.',
        status: p.configured ? 'CONNECTED' : 'NOT_CONFIGURED',
        detail: p.model,
        docs:
          p.id === 'qwen'
            ? 'https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max'
            : p.id === 'kimi'
              ? 'https://platform.moonshot.ai/'
              : '',
      })),
    ],
  });
}
