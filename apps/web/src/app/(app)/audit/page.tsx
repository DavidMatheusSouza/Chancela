import Link from 'next/link';
import { getRepository } from '@/lib/store';
import { explorerTxUrl } from '@/lib/chain';
import { REASON_TEXT } from '@trustagent/shared';
import { Card, Empty, Label, Mono } from '@/components/primitives';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AuditRow, type AuditEntry } from '@/components/audit-row';
import type { TraceStep } from '@/components/pipeline-trace';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const DECISIONS = ['ALL', 'ALLOW', 'DENY', 'REQUIRE_APPROVAL'];
const RISKS = ['ALL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { decision?: string; risk?: string; agent?: string };
}) {
  const repo = await getRepository();
  const agents = await repo.listAgents();
  const events = await repo.listDecisions({
    outcome:
      searchParams.decision && searchParams.decision !== 'ALL'
        ? (searchParams.decision as never)
        : undefined,
    risk: searchParams.risk && searchParams.risk !== 'ALL' ? (searchParams.risk as never) : undefined,
    agentId: searchParams.agent && searchParams.agent !== 'ALL' ? searchParams.agent : undefined,
    limit: 200,
  });

  const qs = (patch: Record<string, string>) =>
    `/audit?${new URLSearchParams({ ...searchParams, ...patch } as Record<string, string>).toString()}`;

  return (
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Audit trail</h1>
            <p className="mt-1 text-[13.5px] text-muted">
              Append-only. Every decision carries the policy version and hash that governed it.
            </p>
          </div>
          <Mono className="text-faint">{events.length} events</Mono>
        </header>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <FilterGroup label="Decision" options={DECISIONS} active={searchParams.decision ?? 'ALL'} href={(v) => qs({ decision: v })} />
          <FilterGroup label="Risk" options={RISKS} active={searchParams.risk ?? 'ALL'} href={(v) => qs({ risk: v })} />
          <FilterGroup
            label="Agent"
            options={['ALL', ...agents.map((a) => a.id)]}
            active={searchParams.agent ?? 'ALL'}
            href={(v) => qs({ agent: v })}
          />
        </div>

        {events.length === 0 ? (
          <Empty title="No matching events" hint="Adjust the filters, or run an action in an agent console." />
        ) : (
          <Card className="overflow-hidden p-0">
            <p className="hairline px-4 py-2 text-[12px] text-faint">
              Select a row to see the intent, the gates it passed and the proof.
            </p>
            <Table>
              <TableHeader>
                <TableRow className="border-line hover:bg-transparent">
                  {['Time', 'Agent', 'Action', 'Decision', 'Risk', 'Reason', 'Policy', 'Proof'].map((h) => (
                    <TableHead key={h} className="label h-9 px-4">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <tbody>
                {events.map((d) => {
                  const entry: AuditEntry = {
                    id: d.id,
                    agentId: d.agentId,
                    action: d.action,
                    outcome: d.outcome,
                    risk: d.risk,
                    reasonCode: d.reasonCode,
                    reasonText:
                      REASON_TEXT[d.reasonCode as keyof typeof REASON_TEXT] ?? d.reasonCode,
                    policyVersion: d.policyVersion,
                    policyHash: d.policyHash,
                    intentHash: d.intentHash,
                    decisionHash: d.decisionHash,
                    parameters: d.parameters ?? {},
                    trace: (Array.isArray(d.trace) ? d.trace : []) as TraceStep[],
                    anchorStatus: d.anchorStatus,
                    txHash: d.onchainTxHash ?? null,
                    txUrl: d.onchainTxHash ? explorerTxUrl(d.onchainTxHash) : null,
                    blockNumber: d.blockNumber ?? null,
                    auditId: d.auditId,
                    createdAt: d.createdAt,
                  };
                  return <AuditRow key={d.id} entry={entry} />;
                })}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
  );
}

function FilterGroup({
  label,
  options,
  active,
  href,
}: {
  label: string;
  options: string[];
  active: string;
  href: (value: string) => string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <Link
            key={o}
            href={href(o)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[11.5px] transition-colors',
              active === o
                ? 'border-chain/45 bg-chain/10 text-ink'
                : 'border-line text-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {o === 'REQUIRE_APPROVAL' ? 'APPROVAL' : o}
          </Link>
        ))}
      </div>
    </div>
  );
}
