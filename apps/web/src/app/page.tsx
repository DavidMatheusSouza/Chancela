import Link from 'next/link';
import { ArrowRight, Boxes, FileCheck2, LogIn, Play, ScrollText, ShieldCheck } from 'lucide-react';
import { InjectionTerminal } from '@/components/injection-terminal';
import { Reveal } from '@/components/reveal';
import { Counter } from '@/components/counter';
import { getRepository } from '@/lib/store';
import { activeChain, chainConfig } from '@/lib/chain';

export const dynamic = 'force-dynamic';

/**
 * Landing page.
 *
 * The only screen reachable without signing in, so it carries the whole first
 * impression. Three things have to land: what the product is, that the model
 * does not decide, and that the refusals are provable.
 *
 * The figures below are counted from the same store the dashboard reads. They
 * are small, and they are real -- a landing page that invents "1,248 actions"
 * is the first thing a judge would check and the last thing they would trust.
 */
export default async function Landing() {
  const repo = await getRepository();
  const [agents, decisions] = await Promise.all([
    repo.listAgents(),
    repo.listDecisions({ limit: 500 }),
  ]);

  const denied = decisions.filter((d) => d.outcome === 'DENY').length;
  const anchored = decisions.filter((d) => d.anchorStatus === 'CONFIRMED').length;
  const chain = activeChain();
  const live = Boolean(chainConfig());

  return (
    <div className="relative">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[520px]" />

      <div className="relative mx-auto max-w-5xl px-6 py-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-chain" />
            <span className="font-semibold tracking-tight">Chancela</span>
          </div>

          <nav className="flex items-center gap-2">
            <a
              href="/demo"
              className="rounded-lg px-3 py-1.5 text-sm text-ink transition-colors hover:text-chain"
            >
              Live demo
            </a>
            <Link
              href="/login"
              className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/login?next=/dashboard"
              className="lift inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            >
              Open dashboard <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </nav>
        </header>

        <section className="mt-20 max-w-3xl">
          <Reveal>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-[11px] uppercase tracking-wider text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-chain dot-live" />
              {live ? `Live on ${chain.name}` : 'Built on Monad'} - ERC-8004 native
            </div>
          </Reveal>

          <Reveal delay={60}>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Give AI agents an identity.
              <br />
              <span className="text-muted">And a limit.</span>
            </h1>
          </Reveal>

          <Reveal delay={120}>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
              ERC-8004 tells you who an agent is. Chancela decides what it is allowed to do, and
              proves why on-chain. Identity, permissions, policies and verifiable accountability for
              autonomous agents.
            </p>
          </Reveal>

          <Reveal delay={180}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="/demo"
                className="lift inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-bg hover:opacity-90"
              >
                <Play className="h-4 w-4" />
                Run the live demo
              </a>
              <Link
                href="/login?next=/dashboard"
                className="lift inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-ink"
              >
                <LogIn className="h-4 w-4" />
                Sign in
              </Link>
              <span className="text-[12.5px] text-faint">No login, no wallet — two minutes, against the real system.</span>
            </div>
          </Reveal>
        </section>

        <Reveal delay={120} className="mt-14">
          <div className="relative h-px overflow-hidden bg-line sweep" />
        </Reveal>

        <Reveal className="mt-14">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
            {[
              { label: 'Agents registered', value: agents.length, tone: 'text-ink' },
              { label: 'Decisions recorded', value: decisions.length, tone: 'text-ink' },
              { label: 'Actions refused', value: denied, tone: 'text-deny' },
              { label: 'Anchored on-chain', value: anchored, tone: 'text-chain' },
            ].map((stat) => (
              <div key={stat.label} className="bg-surface px-5 py-4">
                <dd className={`text-3xl font-semibold tracking-tight ${stat.tone}`}>
                  <Counter value={stat.value} />
                </dd>
                <dt className="mt-1 text-[12px] text-faint">{stat.label}</dt>
              </div>
            ))}
          </dl>
        </Reveal>

        <Reveal className="mt-16">
          <InjectionTerminal />
        </Reveal>

        <Reveal className="mt-16">
          <FlowDiagram />
        </Reveal>

        <section className="mt-20 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: 'The model never decides',
              body: 'An LLM proposes an action. A deterministic policy engine authorizes it. Swap the model and the decision is unchanged.',
            },
            {
              icon: FileCheck2,
              title: 'Deny by default',
              body: 'An action not explicitly granted is refused. Unknown actions are refused. A crash is refused. There is no permissive fallback.',
            },
            {
              icon: ScrollText,
              title: 'Denials are proof too',
              body: 'Every decision is anchored on Monad, including the blocked ones. A registry that only proves the allows proves nothing.',
            },
          ].map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 80}>
              <div className="card lift h-full p-5">
                <Icon className="h-4 w-4 text-chain" />
                <h3 className="mt-3 text-sm font-medium">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
              </div>
            </Reveal>
          ))}
        </section>

        <Reveal className="mt-20">
          <div className="card lit flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">See it refuse something</h2>
              <p className="mt-1 text-[13px] text-muted">
                Ask the agent to move money. Watch the policy engine say no, on-chain.
              </p>
            </div>
            <Link
              href="/login?next=/demo"
              className="lift inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-bg"
            >
              Run the demo <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Reveal>

        <footer className="mt-20 flex items-center gap-2 border-t border-line pt-6 text-xs text-faint">
          <Boxes className="h-3.5 w-3.5" />
          Monad Metropolis 2026 - Track 04: Trust, Identity &amp; AI Infrastructure
        </footer>
      </div>
    </div>
  );
}

function FlowDiagram() {
  const steps = [
    { label: 'AI Agent', detail: 'proposes' },
    { label: 'Intent', detail: 'structured + validated' },
    { label: 'Policy', detail: 'deterministic' },
    { label: 'Allow / Deny', detail: 'with a reason' },
    { label: 'Monad proof', detail: 'immutable' },
  ];

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col divide-y divide-line sm:flex-row sm:divide-x sm:divide-y-0">
        {steps.map((step, i) => (
          <div
            key={step.label}
            className="animate-in-rise flex-1 p-5 transition-colors hover:bg-raised/40"
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <div className="mono text-[11px] text-faint">0{i + 1}</div>
            <div
              className={
                i === 2
                  ? 'mt-2 text-sm font-medium text-allow'
                  : i === 4
                    ? 'mt-2 text-sm font-medium text-chain'
                    : 'mt-2 text-sm font-medium text-ink'
              }
            >
              {step.label}
            </div>
            <div className="mt-0.5 text-[12px] text-faint">{step.detail}</div>
          </div>
        ))}
      </div>
      <div className="hairline bg-surface px-5 py-3 text-[12px] text-muted">
        The LLM interprets. The policy engine authorizes. Monad remembers.
      </div>
    </div>
  );
}
