import Link from 'next/link';
import { getRepository } from '@/lib/store';
import { Badge, Card, Empty, Label, Mono, StatusDot } from '@/components/primitives';
import { Reveal } from '@/components/reveal';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const repo = await getRepository();
  const agents = await repo.listAgents();
  const rows = await Promise.all(
    agents.map(async (a) => ({
      agent: a,
      policy: await repo.getActivePolicy(a.id),
      decisions: (await repo.listDecisions({ agentId: a.id, limit: 200 })).length,
    })),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-muted">
          Each agent is an ERC-8004 identity with exactly one active policy version.
        </p>
      </header>

      {rows.length === 0 ? (
        <Empty
          title="No agents yet"
          hint="Agents are seeded on first run. If this is empty, the store was reset."
        />
      ) : (
      <div className="space-y-3">
        {rows.map(({ agent, policy, decisions }, i) => (
          <Reveal key={agent.id} delay={i * 70}>
          <Link href={`/agents/${agent.id}`} className="block">
            <Card className="lift">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <StatusDot tone={agent.status === 'ACTIVE' ? 'allow' : 'deny'} live={agent.status === 'ACTIVE'} />
                    <span className="font-medium">{agent.name}</span>
                    <Mono className="text-faint">{agent.id}</Mono>
                    {agent.erc8004TokenId ? <Badge tone="chain">#{agent.erc8004TokenId}</Badge> : null}
                  </div>
                  <p className="mt-1 max-w-xl truncate text-[13px] text-muted">{agent.description}</p>
                </div>

                <div className="flex gap-8 text-right">
                  <div>
                    <Label>Permissions</Label>
                    <div className="text-sm tabular-nums">{policy?.document.permissions.length ?? 0}</div>
                  </div>
                  <div>
                    <Label>Policy</Label>
                    <div className="text-sm">v{policy?.version ?? 0}</div>
                  </div>
                  <div>
                    <Label>Decisions</Label>
                    <div className="text-sm tabular-nums">{decisions}</div>
                  </div>
                </div>
              </div>
            </Card>
          </Link>
          </Reveal>
        ))}
      </div>
      )}
    </div>
  );
}
