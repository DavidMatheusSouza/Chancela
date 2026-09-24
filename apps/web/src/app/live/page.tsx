import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { REASON_TEXT, type ReasonCode } from '@chancela/shared';
import { PublicHeader } from '@/components/public-header';
import { DecisionPill, Mono, RiskPill } from '@/components/primitives';
import { AutoRefresh } from '@/components/auto-refresh';
import { AttackPanel } from '@/components/attack-panel';
import { ATTACKS, TRADING_AGENT_ID } from '@/lib/live-bot';
import { getRepository } from '@/lib/store';
import { explorerAddressUrl, explorerTxUrl } from '@/lib/chain';
import { shortHash } from '@/lib/ui';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Live ledger - Chancela',
  description: 'Every decision Chancela makes for an AI agent, refusals included, with its proof on Monad.',
  alternates: { canonical: '/live' },
};

const SHOWN = 60;

/**
 * The public ledger.
 *
 * Everything here was already public one request at a time -- per-agent audit
 * trails, proofs, and the anchors themselves on Monad. This page puts them in
 * one place a judge or an integrator can open without an account, so "every
 * decision is anchored" is something they can watch rather than read. It shows
 * the same projection the audit API does: no parameters, no prompts, no owner.
 */
export default async function LivePage() {
  const repo = await getRepository();
  const [agents, decisions] = await Promise.all([repo.listAgents(), repo.listDecisions({ limit: 500 })]);
  const names = new Map(agents.map((a) => [a.id, a.name]));

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const stats = [
    { label: 'Decisions', value: decisions.length, tone: 'text-ink' },
    { label: 'Refused', value: decisions.filter((d) => d.outcome === 'DENY').length, tone: 'text-deny' },
    { label: 'Held for a human', value: decisions.filter((d) => d.outcome === 'REQUIRE_APPROVAL').length, tone: 'text-warn' },
    { label: 'Anchored on Monad', value: decisions.filter((d) => d.anchorStatus === 'CONFIRMED').length, tone: 'text-chain' },
  ];
  const lastDay = decisions.filter((d) => Date.parse(d.createdAt) >= dayAgo).length;
  const registry = process.env.POLICY_REGISTRY_ADDRESS;
  const trader = agents.find((a) => a.id === TRADING_AGENT_ID);

  return (
    <div className="relative">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[360px]" />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <PublicHeader />

        <section className="mt-12 max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-[11px] uppercase tracking-wider text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-chain dot-live" />
            Live · refreshes every 15s
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Every decision, in public.</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            What agents asked to do, what their policy answered, and the Monad transaction that
            recorded it — refusals included. Open any row to re-check it against the chain. No
            account needed.
          </p>
        </section>

        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface px-5 py-4">
              <dd className={`text-3xl font-semibold tracking-tight ${s.tone}`}>{s.value}</dd>
              <dt className="mt-1 text-[12px] text-faint">{s.label}</dt>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[12px] text-faint">
          {agents.length} agents · {lastDay} decisions in the last 24h
          {registry && (
            <>
              {' '}· registry{' '}
              <a href={explorerAddressUrl(registry)} target="_blank" rel="noreferrer" className="mono hover:text-ink">
                {shortHash(registry)}
              </a>
            </>
          )}
        </p>

        {trader && (
          <AttackPanel
            agentName={trader.name}
            attacks={ATTACKS.map(({ id, prompt, action }) => ({ id, prompt, action }))}
          />
        )}

        <section className="card mt-8 overflow-hidden">
          {decisions.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">No decisions yet.</div>
          ) : (
            <ul className="divide-y divide-line">
              {decisions.slice(0, SHOWN).map((d) => (
                <li key={d.id} className="group relative flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-raised/40 sm:px-5">
                  <div className="flex w-full items-center gap-2 sm:w-auto sm:min-w-[210px]">
                    <DecisionPill decision={d.outcome} />
                    <Link href={`/proof/${d.auditId}`} className="mono text-[12.5px] text-ink after:absolute after:inset-0">
                      {d.action}
                    </Link>
                  </div>
                  <div className="min-w-0 flex-1 text-[12.5px] text-muted">
                    <span className="text-ink">{names.get(d.agentId) ?? d.agentId}</span> ·{' '}
                    {REASON_TEXT[d.reasonCode as ReasonCode] ?? d.reasonCode}
                  </div>
                  <div className="flex items-center gap-3">
                    <RiskPill risk={d.risk} />
                    {d.onchainTxHash ? (
                      <a
                        href={explorerTxUrl(d.onchainTxHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="relative z-10 inline-flex items-center gap-1 text-[11.5px] text-chain hover:underline"
                      >
                        <Mono className="text-chain">{shortHash(d.onchainTxHash)}</Mono>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-[11.5px] text-faint">{d.anchorStatus.toLowerCase()}</span>
                    )}
                    <time className="w-[92px] text-right text-[11.5px] text-faint" dateTime={d.createdAt}>
                      {relative(d.createdAt)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-6 text-[13px] text-muted">
          Want your agent on this list?{' '}
          <a href="https://www.npmjs.com/package/chancela-sdk" target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
            One call before it acts
          </a>{' '}
          — or{' '}
          <a href="/demo" className="text-ink underline-offset-2 hover:underline">
            try to make one misbehave
          </a>
          .
        </p>

        <footer className="mt-16 border-t border-line pt-6 text-xs text-faint">
          Only the action name, outcome, risk, reason and hashes are shown. Parameters, prompts and
          owners stay private.
        </footer>
      </div>
      <AutoRefresh seconds={15} />
    </div>
  );
}

function relative(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
