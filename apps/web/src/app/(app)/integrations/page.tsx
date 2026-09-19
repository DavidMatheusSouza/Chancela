import { availableProviders } from '@trustagent/ai';
import { activeChain, chainConfig, identityRegistryAddress } from '@/lib/chain';
import { isNansenConfigured } from '@/lib/nansen';
import { Badge, Card, Mono } from '@/components/primitives';

export const dynamic = 'force-dynamic';

interface Row {
  name: string;
  role: string;
  status: 'CONNECTED' | 'NOT_CONFIGURED' | 'FALLBACK';
  detail: string;
  docs?: string;
}

/**
 * Integration status.
 *
 * Reflects real runtime checks. Nothing is hardcoded to "connected" for the
 * sake of a screenshot: an integration that is not configured says so, and says
 * what is missing. A fake green dot on this page would undermine the one thing
 * the product is selling.
 */
export default function IntegrationsPage() {
  const chain = activeChain();
  const config = chainConfig();
  const providers = availableProviders();

  const rows: Row[] = [
    {
      name: 'Monad',
      role: 'Settlement and proof layer. Every decision is anchored here.',
      status: config ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: config ? `${chain.name} - chainId ${chain.id}` : 'Set POLICY_REGISTRY_ADDRESS + ATTESTATION_PRIVATE_KEY',
      docs: 'https://docs.monad.xyz/developer-essentials/network-information',
    },
    {
      name: 'ERC-8004 Identity Registry',
      role: 'Agent identity. TrustAgent binds to the standard instead of re-implementing it.',
      status: identityRegistryAddress() ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: identityRegistryAddress() ?? 'No published registry address for this chain',
      docs: 'https://docs.monad.xyz/guides/erc-8004',
    },
    {
      name: 'Privy',
      role: 'Owner auth and server wallets. Key-level policy mirrors the TrustAgent policy.',
      status: process.env.NEXT_PUBLIC_PRIVY_APP_ID ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: process.env.NEXT_PUBLIC_PRIVY_APP_ID ? 'App ID configured' : 'Set NEXT_PUBLIC_PRIVY_APP_ID',
      docs: 'https://docs.privy.io',
    },
    {
      name: 'mera',
      role: "One owner passkey derives one BIP-44 key per agent. No seed phrase.",
      status: process.env.NEXT_PUBLIC_MERA_ENABLED === 'true' ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: 'Passkey-derived agent keys (P256 / WebAuthn)',
      docs: 'https://www.monad.xyz/blog/introducing-mera',
    },
    {
      name: 'Envio HyperIndex',
      role: 'Indexes registry events into GraphQL. The explorer reads the chain, not our database.',
      status: process.env.ENVIO_GRAPHQL_URL ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: process.env.ENVIO_GRAPHQL_URL ?? 'Set ENVIO_GRAPHQL_URL',
      docs: 'https://docs.envio.dev',
    },
    {
      name: 'Nansen',
      role: 'Counterparty labels feed the risk engine. Raises risk; never grants permission.',
      status: isNansenConfigured() ? 'CONNECTED' : 'FALLBACK',
      detail: isNansenConfigured() ? 'API key present' : 'Local denylist fallback in use',
      docs: 'https://docs.nansen.ai',
    },
    ...providers
      .filter((p) => p.id !== 'rules')
      .map<Row>((p) => ({
        name: p.id === 'qwen' ? 'Qwen (Alibaba Cloud)' : p.id === 'kimi' ? 'Kimi (Moonshot)' : 'OpenAI',
        role: 'Intent extraction. Holds no authority over any authorization decision.',
        status: p.configured ? 'CONNECTED' : 'NOT_CONFIGURED',
        detail: p.model,
        docs:
          p.id === 'qwen'
            ? 'https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max'
            : p.id === 'kimi'
              ? 'https://platform.moonshot.ai/'
              : 'https://platform.openai.com/docs',
      })),
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-muted">
          Live status. An integration that is not configured says so.
        </p>
      </header>

      <div className="space-y-2.5">
        {rows.map((row) => (
          <Card key={row.name} className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-xl">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-medium">{row.name}</span>
                <Badge tone={row.status === 'CONNECTED' ? 'allow' : row.status === 'FALLBACK' ? 'warn' : 'neutral'}>
                  {row.status.replace('_', ' ')}
                </Badge>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{row.role}</p>
              <Mono className="mt-1.5 block text-faint">{row.detail}</Mono>
            </div>
            {row.docs ? (
              <a href={row.docs} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] text-chain hover:underline">
                Documentation
              </a>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
