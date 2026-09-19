import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRepository } from '@/lib/store';
import { Badge, Card, Field, Mono } from '@/components/primitives';
import { shortHash } from '@/lib/ui';
import { PolicyBuilder } from './policy-builder';

export const dynamic = 'force-dynamic';

export default async function PolicyPage({ params }: { params: { id: string } }) {
  const repo = await getRepository();
  const agent = await repo.getAgent(params.id);
  if (!agent) notFound();

  const active = await repo.getActivePolicy(params.id);
  const history = await repo.listPolicies(params.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <Link href={`/agents/${agent.id}`} className="text-xs text-muted hover:text-ink">
        &larr; {agent.name}
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Policy</h1>
          <p className="mt-1 text-sm text-muted">
            A policy version is immutable once active. Changing it mints a new version and a new hash.
          </p>
        </div>
        {active ? <Badge tone="chain">v{active.version} active</Badge> : <Badge>No active policy</Badge>}
      </header>

      <Card className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Active version" value={`v${active?.version ?? 0}`} mono />
          <Field label="Active hash" value={shortHash(active?.policyHash, 12, 8)} mono />
          <Field label="Step-up threshold" value={active?.document.stepUpThreshold ?? '--'} mono />
        </div>

        {active ? (
          <div className="border-t border-line pt-5">
            <PolicyBuilder
              agentId={agent.id}
              activeVersion={active.version}
              activeHash={active.policyHash}
              document={active.document}
            />
          </div>
        ) : (
          <p className="border-t border-line pt-5 text-[13px] text-muted">
            This agent has no active policy, so there is nothing to base a new version on.
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium">Policy document</h2>
        <p className="text-[12px] text-faint">
          This exact object, serialised canonically, is what the policy hash commits to. Anyone can
          recompute it and compare against the chain.
        </p>
        <pre className="mono overflow-x-auto rounded-lg border border-line bg-bg p-4 text-[12px] leading-relaxed text-muted">
          {JSON.stringify(active?.document ?? {}, null, 2)}
        </pre>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium">Version history</h2>
        <ul className="space-y-1.5">
          {history.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px]">
              <span className="flex items-center gap-2.5">
                <Mono className="text-ink">v{p.version}</Mono>
                <Badge tone={p.status === 'ACTIVE' ? 'allow' : 'neutral'}>{p.status}</Badge>
              </span>
              <Mono className="text-faint">{shortHash(p.policyHash, 10, 6)}</Mono>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
