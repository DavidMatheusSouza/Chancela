import Link from 'next/link';
import { getRepository } from '@/lib/store';
import { activeChain, explorerTxUrl } from '@/lib/chain';
import { Badge, Card, DecisionPill, Empty, Label, Mono } from '@/components/primitives';
import { formatTime, shortHash } from '@/lib/ui';

export const dynamic = 'force-dynamic';

/**
 * Trust Activity Explorer.
 *
 * Fed by Envio when ENVIO_GRAPHQL_URL is set, so the view reads indexed chain
 * events rather than our own database. The source is labelled either way --
 * claiming on-chain provenance we do not have would be the one unforgivable
 * thing on this page.
 */
export default async function ActivityPage() {
  const repo = await getRepository();
  const decisions = await repo.listDecisions({ limit: 100 });
  const chain = activeChain();
  const indexed = Boolean(process.env.ENVIO_GRAPHQL_URL);

  const anchored = decisions.filter((d) => d.anchorStatus === 'CONFIRMED').length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Trust activity explorer</h1>
          <p className="mt-1 text-sm text-muted">
            Authorization events as recorded on {chain.name}.
          </p>
        </div>
        <Badge tone={indexed ? 'chain' : 'neutral'}>
          Source: {indexed ? 'Envio HyperIndex' : 'local (indexer not configured)'}
        </Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="space-y-1.5">
          <Label>Decisions recorded</Label>
          <div className="text-2xl font-semibold tabular-nums">{decisions.length}</div>
        </Card>
        <Card className="space-y-1.5">
          <Label>Anchored on-chain</Label>
          <div className="text-2xl font-semibold tabular-nums text-chain">{anchored}</div>
        </Card>
        <Card className="space-y-1.5">
          <Label>Network</Label>
          <div className="text-sm">{chain.name}</div>
          <Mono className="text-faint">chainId {chain.id}</Mono>
        </Card>
      </div>

      {decisions.length === 0 ? (
        <Empty title="No activity yet" hint="Decisions appear here as soon as an agent acts." />
      ) : (
        <div className="space-y-2">
          {decisions.map((d) => (
            <Card key={d.id} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <DecisionPill decision={d.outcome} />
                <Mono className="text-ink">{d.action}</Mono>
                <Link href={`/agents/${d.agentId}`} className="text-[13px] text-muted hover:text-ink">
                  {d.agentId}
                </Link>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <Label>Policy</Label>
                  <Mono>v{d.policyVersion} - {shortHash(d.policyHash, 6, 4)}</Mono>
                </div>
                <div className="text-right">
                  <Label>Proof</Label>
                  {d.onchainTxHash ? (
                    <a href={explorerTxUrl(d.onchainTxHash)} target="_blank" rel="noreferrer" className="mono text-[12.5px] text-chain hover:underline">
                      {shortHash(d.onchainTxHash)}
                    </a>
                  ) : (
                    <Mono className="text-faint">{d.anchorStatus.toLowerCase()}</Mono>
                  )}
                </div>
                <Mono className="text-faint">{formatTime(d.createdAt)}</Mono>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
