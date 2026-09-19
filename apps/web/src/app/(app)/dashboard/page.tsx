import Link from 'next/link';
import { getRepository } from '@/lib/store';
import { computeTrustScore } from '@/lib/trust-score';
import { activeChain, explorerTxUrl } from '@/lib/chain';
import { Card, DecisionPill, Empty, Mono, RiskPill, StatusDot } from '@/components/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn, formatTime, shortHash } from '@/lib/ui';

export const dynamic = 'force-dynamic';

/**
 * Operations overview.
 *
 * Written as a console rather than a landing page: no greeting, no tile
 * explaining what the tile means, and the decision table gets the room instead
 * of a row of equal-sized cards. Someone opening this is checking state, and
 * the first thing they want is the most recent refusal, not a welcome.
 */
export default async function Dashboard() {
  const repo = await getRepository();
  const agents = await repo.listAgents();
  const decisions = await repo.listDecisions({ limit: 60 });
  const chain = activeChain();

  const today = new Date().toISOString().slice(0, 10);
  const todays = decisions.filter((d) => d.createdAt.slice(0, 10) === today);
  const blocked = todays.filter((d) => d.outcome === 'DENY').length;
  const anchored = decisions.filter((d) => d.anchorStatus === 'CONFIRMED').length;

  const rows = await Promise.all(
    agents.map(async (a) => {
      const policy = await repo.getActivePolicy(a.id);
      const agentDecisions = await repo.listDecisions({ agentId: a.id, limit: 200 });
      return {
        agent: a,
        policyVersion: policy?.version ?? 0,
        permissions: policy?.document.permissions.length ?? 0,
        total: agentDecisions.length,
        refused: agentDecisions.filter((d) => d.outcome === 'DENY').length,
        score: computeTrustScore({
          hasVerifiedOwner: Boolean(a.erc8004TokenId),
          policyVersion: policy?.version ?? 1,
          decisions: agentDecisions,
        }).score,
      };
    }),
  );

  const stats: Array<{ label: string; value: string; tone?: string }> = [
    {
      label: 'Agents',
      value: `${agents.filter((a) => a.status === 'ACTIVE').length}/${agents.length}`,
    },
    { label: 'Requests today', value: String(todays.length) },
    { label: 'Refused today', value: String(blocked), tone: blocked ? 'text-deny' : undefined },
    { label: 'Anchored', value: `${anchored}/${decisions.length}`, tone: 'text-chain' },
    { label: 'Chain', value: String(chain.id) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[15px] font-medium tracking-tight">Overview</h1>
        <Link href="/audit" className="text-[12px] text-muted transition-colors hover:text-ink">
          Audit trail &rarr;
        </Link>
      </div>

      <dl className="flex flex-wrap divide-x divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {stats.map((s) => (
          <div key={s.label} className="min-w-[126px] flex-1 px-4 py-3">
            <dt className="label">{s.label}</dt>
            <dd
              className={cn(
                'mt-1 text-[19px] font-medium tabular-nums tracking-tight',
                s.tone ?? 'text-ink',
              )}
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="label">Recent decisions</h2>
          <span className="text-[11px] text-faint">newest first</span>
        </div>

        {decisions.length === 0 ? (
          <Empty title="No decisions yet" hint="Open an agent console and ask it to do something." />
        ) : (
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-line hover:bg-transparent">
                  {['Time', 'Agent', 'Action', 'Decision', 'Risk', 'Reason', 'Proof'].map((h) => (
                    <TableHead key={h} className="label h-8 px-3">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.slice(0, 15).map((d) => (
                  <TableRow
                    key={d.id}
                    className={cn(
                      'border-line/60 hover:bg-raised/50',
                      d.outcome === 'DENY' && d.risk === 'CRITICAL' && 'bg-deny/[0.03]',
                    )}
                  >
                    <TableCell className="px-3 py-1.5">
                      <Mono className="text-[12px]">{formatTime(d.createdAt)}</Mono>
                    </TableCell>
                    <TableCell className="px-3 py-1.5">
                      <Link
                        href={`/agents/${d.agentId}`}
                        className="text-[12.5px] text-muted hover:text-ink"
                      >
                        {d.agentId}
                      </Link>
                    </TableCell>
                    <TableCell className="px-3 py-1.5">
                      <Mono className="text-[12px] text-ink">{d.action}</Mono>
                    </TableCell>
                    <TableCell className="px-3 py-1.5">
                      <DecisionPill decision={d.outcome} />
                    </TableCell>
                    <TableCell className="px-3 py-1.5">
                      <RiskPill risk={d.risk} />
                    </TableCell>
                    <TableCell className="px-3 py-1.5">
                      <Mono className="text-[11.5px] text-faint">{d.reasonCode}</Mono>
                    </TableCell>
                    <TableCell className="px-3 py-1.5">
                      {d.onchainTxHash ? (
                        <a
                          href={explorerTxUrl(d.onchainTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="mono text-[11.5px] text-chain hover:underline"
                        >
                          {shortHash(d.onchainTxHash)}
                        </a>
                      ) : (
                        <Mono className="text-[11.5px] text-faint">
                          {d.anchorStatus.toLowerCase()}
                        </Mono>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="label">Agents</h2>
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-line hover:bg-transparent">
                {['', 'Agent', 'Policy', 'Perms', 'Decisions', 'Refused', 'Trust'].map((h, i) => (
                  <TableHead key={i} className="label h-8 px-3">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.agent.id} className="border-line/60 hover:bg-raised/50">
                  <TableCell className="w-8 px-3 py-1.5">
                    <StatusDot
                      tone={r.agent.status === 'ACTIVE' ? 'allow' : 'deny'}
                      live={r.agent.status === 'ACTIVE'}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-1.5">
                    <Link href={`/agents/${r.agent.id}`} className="text-[13px] hover:underline">
                      {r.agent.name}
                    </Link>
                    <Mono className="ml-2 text-[11.5px] text-faint">{r.agent.id}</Mono>
                  </TableCell>
                  <TableCell className="px-3 py-1.5">
                    <Mono className="text-[12px]">v{r.policyVersion}</Mono>
                  </TableCell>
                  <TableCell className="px-3 py-1.5 text-[12.5px] tabular-nums text-muted">
                    {r.permissions}
                  </TableCell>
                  <TableCell className="px-3 py-1.5 text-[12.5px] tabular-nums text-muted">
                    {r.total}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'px-3 py-1.5 text-[12.5px] tabular-nums',
                      r.refused ? 'text-deny' : 'text-muted',
                    )}
                  >
                    {r.refused}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'px-3 py-1.5 text-[12.5px] tabular-nums',
                      r.score >= 70 ? 'text-allow' : 'text-warn',
                    )}
                  >
                    {r.score}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
