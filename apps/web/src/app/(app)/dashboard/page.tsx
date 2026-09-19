import Link from 'next/link';
import { getRepository } from '@/lib/store';
import { computeTrustScore } from '@/lib/trust-score';
import { explorerTxUrl } from '@/lib/chain';
import { Card, DecisionPill, Empty, Label, Metric, Mono, RiskPill, StatusDot } from '@/components/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatTime, shortHash } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const repo = await getRepository();
  const agents = await repo.listAgents();
  const decisions = await repo.listDecisions({ limit: 50 });

  const today = new Date().toISOString().slice(0, 10);
  const todays = decisions.filter((d) => d.createdAt.slice(0, 10) === today);
  const blocked = todays.filter((d) => d.outcome === 'DENY').length;

  const scores = await Promise.all(
    agents.map(async (a) => {
      const policy = await repo.getActivePolicy(a.id);
      const agentDecisions = await repo.listDecisions({ agentId: a.id, limit: 200 });
      return computeTrustScore({
        hasVerifiedOwner: Boolean(a.erc8004TokenId),
        policyVersion: policy?.version ?? 1,
        decisions: agentDecisions,
      }).score;
    }),
  );
  const avgTrust = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">{greeting()}, David</h1>
        <p className="mt-1 text-sm text-muted">
          {agents.length} agents under policy. Every decision below is anchored, including the refusals.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Agents" value={agents.length} hint={`${agents.filter((a) => a.status === 'ACTIVE').length} active`} />
        <Metric label="Avg trust score" value={avgTrust} hint="Explainable, never authoritative" tone={avgTrust >= 70 ? 'allow' : 'warn'} />
        <Metric label="Actions today" value={todays.length} hint="Authorization requests" />
        <Metric
          label="Blocked today"
          value={blocked}
          hint={blocked ? 'Refused by policy' : 'Nothing refused yet'}
          tone={blocked ? 'deny' : undefined}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Agent activity</h2>
          <Link href="/audit" className="text-xs text-muted hover:text-ink">
            Full audit trail
          </Link>
        </div>

        {decisions.length === 0 ? (
          <Empty
            title="No decisions yet"
            hint="Open an agent console and ask it to do something."
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-line hover:bg-transparent">
                  {['Time', 'Agent', 'Action', 'Decision', 'Risk', 'Proof'].map((h) => (
                    <TableHead key={h} className="label h-9 px-4">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.slice(0, 12).map((d) => (
                  <TableRow key={d.id} className="border-line/60 hover:bg-raised/50">
                    <TableCell className="px-4 py-2"><Mono>{formatTime(d.createdAt)}</Mono></TableCell>
                    <TableCell className="px-4 py-2">
                      <Link href={`/agents/${d.agentId}`} className="text-[13px] text-muted hover:text-ink hover:underline">
                        {d.agentId}
                      </Link>
                    </TableCell>
                    <TableCell className="px-4 py-2"><Mono className="text-ink">{d.action}</Mono></TableCell>
                    <TableCell className="px-4 py-2"><DecisionPill decision={d.outcome} /></TableCell>
                    <TableCell className="px-4 py-2"><RiskPill risk={d.risk} /></TableCell>
                    <TableCell className="px-4 py-2">
                      {d.onchainTxHash ? (
                        <a href={explorerTxUrl(d.onchainTxHash)} target="_blank" rel="noreferrer" className="mono text-[12px] text-chain hover:underline">
                          {shortHash(d.onchainTxHash)}
                        </a>
                      ) : (
                        <Mono className="text-faint">{shortHash(d.decisionHash)}</Mono>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Agents</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a, i) => (
            <Link key={a.id} href={`/agents/${a.id}`} className="card p-4 transition-colors hover:bg-raised">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{a.name}</span>
                <StatusDot tone={a.status === 'ACTIVE' ? 'allow' : 'deny'} />
              </div>
              <Mono className="mt-1 block text-faint">{a.id}</Mono>
              <div className="mt-3 flex items-center justify-between">
                <Label>Trust</Label>
                <span className="text-sm tabular-nums">{scores[i]}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
