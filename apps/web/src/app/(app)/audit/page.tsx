import Link from 'next/link';
import { getRepository } from '@/lib/store';
import { explorerTxUrl } from '@/lib/chain';
import { Card, DecisionPill, Empty, Label, Mono, RiskPill } from '@/components/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTime, shortHash } from '@/lib/ui';
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
    <TooltipProvider delayDuration={200}>
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
              <TableBody>
                {events.map((d) => (
                  <TableRow
                    key={d.id}
                    className={cn(
                      'border-line/60 transition-colors hover:bg-raised/50',
                      // A denied critical action is the row an operator is scanning for.
                      d.outcome === 'DENY' && d.risk === 'CRITICAL' && 'bg-deny/[0.035]',
                    )}
                  >
                    <TableCell className="px-4 py-2"><Mono>{formatTime(d.createdAt)}</Mono></TableCell>
                    <TableCell className="px-4 py-2">
                      <Link href={`/agents/${d.agentId}`} className="text-[13px] text-muted hover:text-ink hover:underline">
                        {d.agentId}
                      </Link>
                    </TableCell>
                    <TableCell className="px-4 py-2"><Mono className="text-ink">{d.action}</Mono></TableCell>
                    <TableCell className="px-4 py-2"><DecisionPill decision={d.outcome} /></TableCell>
                    <TableCell className="px-4 py-2"><RiskPill risk={d.risk} /></TableCell>
                    <TableCell className="px-4 py-2"><Mono className="text-faint">{d.reasonCode}</Mono></TableCell>
                    <TableCell className="px-4 py-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span><Mono>v{d.policyVersion}</Mono></span>
                        </TooltipTrigger>
                        <TooltipContent className="mono text-[11px]">{d.policyHash}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="px-4 py-2">
                      {d.onchainTxHash ? (
                        <a
                          href={explorerTxUrl(d.onchainTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="mono text-[12px] text-chain hover:underline"
                        >
                          {shortHash(d.onchainTxHash)}
                        </a>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span><Mono className="text-faint">{shortHash(d.decisionHash)}</Mono></span>
                          </TooltipTrigger>
                          <TooltipContent className="text-[11px]">
                            Not anchored: {d.anchorStatus.toLowerCase()}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </TooltipProvider>
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
