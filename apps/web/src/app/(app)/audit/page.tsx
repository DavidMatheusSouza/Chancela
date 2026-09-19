import Link from 'next/link';
import { getRepository } from '@/lib/store';
import { explorerTxUrl } from '@/lib/chain';
import { Card, Empty, Mono } from '@/components/primitives';
import { DECISION_STYLE, RISK_STYLE, formatTime, shortHash } from '@/lib/ui';

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
    outcome: searchParams.decision && searchParams.decision !== 'ALL' ? (searchParams.decision as never) : undefined,
    risk: searchParams.risk && searchParams.risk !== 'ALL' ? (searchParams.risk as never) : undefined,
    agentId: searchParams.agent && searchParams.agent !== 'ALL' ? searchParams.agent : undefined,
    limit: 200,
  });

  const qs = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ ...searchParams, ...patch } as Record<string, string>);
    return `/audit?${next.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit trail</h1>
        <p className="mt-1 text-sm text-muted">
          Append-only. Every decision carries the policy version and hash that governed it.
        </p>
      </header>

      <div className="flex flex-wrap gap-6">
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
        <Card className="p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                {['Time', 'Agent', 'Action', 'Decision', 'Risk', 'Reason', 'Policy', 'Proof'].map((h) => (
                  <th key={h} className="label px-4 py-2.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((d) => (
                <tr key={d.id} className="border-b border-line/60 last:border-0 hover:bg-raised/40">
                  <td className="px-4 py-2.5"><Mono>{formatTime(d.createdAt)}</Mono></td>
                  <td className="px-4 py-2.5"><Link href={`/agents/${d.agentId}`} className="hover:underline">{d.agentId}</Link></td>
                  <td className="px-4 py-2.5"><Mono className="text-ink">{d.action}</Mono></td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] font-medium ${DECISION_STYLE[d.outcome]}`}>
                      {d.outcome === 'ALLOW' ? '✓' : d.outcome === 'DENY' ? '✕' : '!'} {d.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] ${RISK_STYLE[d.risk]}`}>{d.risk}</span>
                  </td>
                  <td className="px-4 py-2.5"><Mono className="text-faint">{d.reasonCode}</Mono></td>
                  <td className="px-4 py-2.5"><Mono>v{d.policyVersion}</Mono></td>
                  <td className="px-4 py-2.5">
                    {d.onchainTxHash ? (
                      <a href={explorerTxUrl(d.onchainTxHash)} target="_blank" rel="noreferrer" className="mono text-[12.5px] text-chain hover:underline">
                        {shortHash(d.onchainTxHash)}
                      </a>
                    ) : (
                      <Mono className="text-faint">{shortHash(d.decisionHash)}</Mono>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      <div className="label">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <Link
            key={o}
            href={href(o)}
            className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${
              active === o ? 'border-chain/50 bg-chain/10 text-ink' : 'border-line text-muted hover:text-ink'
            }`}
          >
            {o}
          </Link>
        ))}
      </div>
    </div>
  );
}
