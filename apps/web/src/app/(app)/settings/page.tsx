import { activeChain, chainConfig, identityRegistryAddress } from '@/lib/chain';
import { Badge, Card, Field, Mono } from '@/components/primitives';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const chain = activeChain();
  const config = chainConfig();
  const attestorConfigured = Boolean(process.env.ATTESTATION_PRIVATE_KEY);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Runtime configuration, read from the environment.</p>
      </header>

      <Card className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Attestation key</h2>
          <Badge tone={attestorConfigured ? 'allow' : 'deny'}>
            {attestorConfigured ? 'Configured' : 'Missing'}
          </Badge>
        </div>
        <p className="text-[13px] leading-relaxed text-muted">
          The attestation key signs authorization capsules. It must never be an agent&apos;s operating
          wallet key -- an agent that can sign its own authorizations proves nothing. The on-chain
          registry enforces the same separation in <Mono>setAttestor()</Mono>.
        </p>
        {!attestorConfigured ? (
          <pre className="mono rounded-lg border border-line bg-bg p-3 text-[12px] text-muted">
            cast wallet new{'\n'}export ATTESTATION_PRIVATE_KEY=0x...
          </pre>
        ) : null}
      </Card>

      <Card className="space-y-5">
        <h2 className="text-sm font-medium">Network</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Chain" value={chain.name} />
          <Field label="Chain ID" value={chain.id} mono />
          <Field label="RPC" value={config?.rpcUrl ?? chain.rpcUrls.default.http[0]} mono />
          <Field label="Explorer" value={chain.blockExplorers.default.url} mono />
          <Field label="Policy registry" value={config?.registryAddress ?? 'not deployed'} mono />
          <Field label="ERC-8004 identity" value={identityRegistryAddress() ?? 'unset for this chain'} mono />
        </div>
      </Card>
    </div>
  );
}
