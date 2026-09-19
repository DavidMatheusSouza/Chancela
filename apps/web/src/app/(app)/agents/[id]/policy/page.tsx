import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PERMISSIONS, PERMISSION_LABELS, TOOL_REGISTRY } from '@trustagent/shared';
import { getRepository } from '@/lib/store';
import { Badge, Card, Field, Label, Mono } from '@/components/primitives';
import { RISK_STYLE, shortHash } from '@/lib/ui';
import { cn } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export default async function PolicyPage({ params }: { params: { id: string } }) {
  const repo = await getRepository();
  const agent = await repo.getAgent(params.id);
  if (!agent) notFound();

  const active = await repo.getActivePolicy(params.id);
  const history = await repo.listPolicies(params.id);
  const granted = new Set(active?.document.permissions ?? []);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <Link href={`/agents/${agent.id}`} className="text-xs text-muted hover:text-ink">
        &larr; {agent.name}
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Policy</h1>
          <p className="mt-1 text-sm text-muted">
            A policy version is immutable once active. Changing it mints a new version and a new hash.
          </p>
        </div>
        {active ? <Badge tone="chain">v{active.version} active</Badge> : <Badge>No active policy</Badge>}
      </header>

      <Card className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Version" value={`v${active?.version ?? 0}`} mono />
          <Field label="Policy hash" value={shortHash(active?.policyHash, 12, 8)} mono />
          <Field label="Step-up threshold" value={active?.document.stepUpThreshold ?? '--'} mono />
        </div>

        <div className="border-t border-line pt-5">
          <Label>Permissions</Label>
          <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {PERMISSIONS.map((code) => {
              const has = granted.has(code);
              const tool = TOOL_REGISTRY.find((t) => t.requiredPermission === code);
              return (
                <li
                  key={code}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-[13px]',
                    has ? 'border-allow/30 bg-allow/[0.05]' : 'border-line',
                  )}
                >
                  <span className={cn('mono', has ? 'text-allow' : 'text-faint')}>{has ? '☑' : '☐'}</span>
                  <span className={has ? 'text-ink' : 'text-faint'}>{PERMISSION_LABELS[code]}</span>
                  {tool ? (
                    <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] ${RISK_STYLE[tool.risk]}`}>
                      {tool.risk}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-3">
          <Field label="Max transaction" value={`$${((active?.document.limits.maxTransactionValue ?? 0) / 100).toFixed(2)}`} mono />
          <Field label="Daily transactions" value={active?.document.limits.dailyTransactions ?? 0} mono />
          <Field label="Daily value cap" value={`$${((active?.document.limits.dailyValueCap ?? 0) / 100).toFixed(2)}`} mono />
        </div>
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
