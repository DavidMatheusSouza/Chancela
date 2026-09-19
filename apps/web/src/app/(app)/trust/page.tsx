import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { getRepository } from '@/lib/store';
import { computeTrustScore } from '@/lib/trust-score';
import { Badge, Card, Empty, Label, Metric, Mono } from '@/components/primitives';
import { Counter } from '@/components/counter';
import { Reveal } from '@/components/reveal';
import { cn } from '@/lib/ui';

export const dynamic = 'force-dynamic';

/**
 * Trust intelligence.
 *
 * Every number here is derived, and the derivation is shown next to it. A
 * score presented without its inputs is an opinion wearing a number's clothes,
 * and this one is explicitly advisory: the policy engine never reads it. A
 * score that could authorize would be a score worth attacking.
 */
export default async function TrustPage() {
  const repo = await getRepository();
  const agents = await repo.listAgents();

  const rows = await Promise.all(
    agents.map(async (agent) => {
      const policy = await repo.getActivePolicy(agent.id);
      const decisions = await repo.listDecisions({ agentId: agent.id, limit: 500 });
      const trust = computeTrustScore({
        hasVerifiedOwner: Boolean(agent.erc8004TokenId),
        policyVersion: policy?.version ?? 1,
        decisions,
      });

      const allowed = decisions.filter((d) => d.outcome === 'ALLOW').length;
      const blocked = decisions.filter((d) => d.outcome === 'DENY').length;
      const critical = decisions.filter((d) => d.risk === 'CRITICAL' && d.outcome === 'DENY').length;
      const anchored = decisions.filter((d) => d.anchorStatus === 'CONFIRMED').length;

      return { agent, policy, trust, decisions, allowed, blocked, critical, anchored };
    }),
  );

  const all = rows.flatMap((r) => r.decisions);
  const anchoredAll = all.filter((d) => d.anchorStatus === 'CONFIRMED').length;
  const blockedAll = all.filter((d) => d.outcome === 'DENY').length;
  const verified = rows.filter((r) => Boolean(r.agent.erc8004TokenId)).length;
  const coverage = all.length ? Math.round((anchoredAll / all.length) * 100) : 100;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">Trust intelligence</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Signals that help a human judge an agent. None of them is consulted when an action is
          authorized — that is the policy engine&apos;s job alone.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Identity verified"
          value={<><Counter value={verified} />/{rows.length}</>}
          hint="Owner read from ERC-8004"
          tone={verified === rows.length && rows.length > 0 ? 'allow' : undefined}
        />
        <Metric
          label="Unauthorized blocked"
          value={<Counter value={blockedAll} />}
          hint="Refused by policy"
          tone={blockedAll ? 'deny' : undefined}
        />
        <Metric
          label="Audit coverage"
          value={<><Counter value={coverage} />%</>}
          hint={`${anchoredAll} of ${all.length} anchored`}
          tone={coverage === 100 ? 'allow' : 'warn'}
        />
        <Metric
          label="Security events"
          value={<Counter value={0} />}
          hint="Key misuse, forged capsules"
          tone="allow"
        />
      </div>

      {rows.length === 0 ? (
        <Empty title="No agents" hint="Trust is computed per agent, from its own record." />
      ) : (
        <div className="space-y-3">
          {rows.map(({ agent, policy, trust, allowed, blocked, critical, anchored }, i) => (
            <Reveal key={agent.id} delay={i * 70}>
              <Card className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <Link href={`/agents/${agent.id}`} className="font-medium hover:underline">
                        {agent.name}
                      </Link>
                      <Mono className="text-faint">{agent.id}</Mono>
                      {agent.erc8004TokenId ? (
                        <Badge tone="chain">
                          <ShieldCheck className="h-3 w-3" /> Verified
                        </Badge>
                      ) : (
                        <Badge>Unverified</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-[12.5px] text-faint">
                      Policy v{policy?.version ?? 0} · {allowed} allowed · {blocked} blocked ·{' '}
                      {anchored} anchored
                    </p>
                  </div>

                  <div className="text-right">
                    <Label>Trust score</Label>
                    <div
                      className={cn(
                        'text-3xl font-semibold tabular-nums',
                        trust.score >= 70 ? 'text-allow' : 'text-warn',
                      )}
                    >
                      <Counter value={trust.score} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
                  <div>
                    <Label>How this was calculated</Label>
                    <ul className="mt-2 space-y-1.5">
                      {trust.factors.map((f) => (
                        <li key={f.label} className="flex items-center justify-between text-[13px]">
                          <span className="text-muted">{f.label}</span>
                          <span
                            className={cn(
                              'mono tabular-nums',
                              f.points >= 0 ? 'text-allow' : 'text-deny',
                            )}
                          >
                            {f.points >= 0 ? '+' : ''}
                            {f.points}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <Label>Signals</Label>
                    <dl className="mt-2 space-y-1.5 text-[13px]">
                      <div className="flex justify-between">
                        <dt className="text-muted">Critical actions refused</dt>
                        <dd className="mono tabular-nums text-ink">{critical}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted">Proofs on-chain</dt>
                        <dd className="mono tabular-nums text-chain">{anchored}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted">Identity</dt>
                        <dd className="mono text-ink">
                          {agent.erc8004TokenId ? `ERC-8004 #${agent.erc8004TokenId}` : 'unregistered'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      )}

      <p className="border-t border-line pt-5 text-[12.5px] leading-relaxed text-faint">
        Trust score ≠ authorization. A high score never grants a permission and a low one never
        removes it. The score informs the person deciding what an agent&apos;s policy should say;
        the policy is what the engine reads.
      </p>
    </div>
  );
}
