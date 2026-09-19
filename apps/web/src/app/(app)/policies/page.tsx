import Link from 'next/link';
import { getRepository } from '@/lib/store';
import { Badge, Card, Label, Mono } from '@/components/primitives';
import { shortHash } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export default async function PoliciesPage() {
  const repo = await getRepository();
  const agents = await repo.listAgents();
  const rows = await Promise.all(
    agents.map(async (a) => ({ agent: a, policies: await repo.listPolicies(a.id) })),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Policies</h1>
        <p className="mt-1 text-sm text-muted">
          One active version per agent. History is kept so past decisions stay explainable.
        </p>
      </header>

      <div className="space-y-3">
        {rows.map(({ agent, policies }) => (
          <Card key={agent.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <Link href={`/agents/${agent.id}/policy`} className="text-sm font-medium hover:underline">
                {agent.name}
              </Link>
              <Mono className="text-faint">{agent.id}</Mono>
            </div>
            <ul className="space-y-1.5">
              {policies.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px]">
                  <span className="flex items-center gap-2.5">
                    <Mono className="text-ink">v{p.version}</Mono>
                    <Badge tone={p.status === 'ACTIVE' ? 'allow' : 'neutral'}>{p.status}</Badge>
                    <span className="text-muted">{p.document.permissions.length} permissions</span>
                  </span>
                  <Mono className="text-faint">{shortHash(p.policyHash, 10, 6)}</Mono>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
