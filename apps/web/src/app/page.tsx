import Link from 'next/link';
import { ArrowRight, Boxes, FileCheck2, ScrollText, ShieldCheck } from 'lucide-react';
import { InjectionTerminal } from '@/components/injection-terminal';

/**
 * Landing page.
 *
 * The hero diagram is the product thesis in one glance -- a judge who reads
 * nothing else should still understand where the decision is made.
 */
export default function Landing() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-20">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-chain" />
          <span className="font-semibold tracking-tight">TrustAgent</span>
        </div>
        <Link href="/dashboard" className="text-sm text-muted transition-colors hover:text-ink">
          Open dashboard <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
        </Link>
      </header>

      <section className="mt-24 max-w-3xl">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[11px] uppercase tracking-wider text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-chain dot-live" />
          Built on Monad - ERC-8004 native
        </div>

        <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">
          Give AI agents an identity.
          <br />
          <span className="text-muted">And a limit.</span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
          ERC-8004 tells you who an agent is. TrustAgent decides what it is allowed to do, and
          proves why on-chain. Identity, permissions, policies and verifiable accountability for
          autonomous agents.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/agents"
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
          >
            Create agent
          </Link>
          <Link
            href="/agents/TA-001/console"
            className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink transition-colors hover:bg-surface"
          >
            View demo
          </Link>
        </div>
      </section>

      <section className="mt-20">
        <InjectionTerminal />
      </section>

      <section className="mt-16">
        <FlowDiagram />
      </section>

      <section className="mt-24 grid gap-4 sm:grid-cols-3">
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
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="card p-5">
            <Icon className="h-4 w-4 text-chain" />
            <h3 className="mt-3 text-sm font-medium">{title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-24 flex items-center gap-2 border-t border-line pt-6 text-xs text-faint">
        <Boxes className="h-3.5 w-3.5" />
        Monad Metropolis 2026 - Track 04: Trust, Identity &amp; AI Infrastructure
      </footer>
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
          <div key={step.label} className="flex-1 p-5">
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
