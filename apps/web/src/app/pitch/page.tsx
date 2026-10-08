import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PublicHeader } from '@/components/public-header';
import { PublicFooter } from '@/components/public-footer';

// Rendered per request, like the landing page: a prerendered page is sent with
// a year of s-maxage, and the edge would keep serving it after the text changed.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'The pitch - Chancela',
  description:
    'Who needs an authorization layer for AI agents, why they will not write it themselves, how long it takes to adopt, and where Chancela stands today.',
  alternates: { canonical: '/pitch' },
};

const REPO = 'https://github.com/DavidMatheusSouza/Chancela';

const WHO = [
  {
    title: 'Teams running trading or treasury agents',
    body: 'A per-order and per-day limit a prompt injection cannot move, and a record their users can check.',
  },
  {
    title: 'Venues and protocols',
    body: 'Accept orders from agents without trusting the agent: an order without a grant for exactly that call reverts.',
  },
  {
    title: 'Platforms hosting agents for other people',
    body: 'Show each owner what their agent was allowed to do, and what it tried.',
  },
];

const NOT_WRITTEN = [
  'Binding the permission to the exact parameters, so nothing is swapped after the check.',
  'Nonces and a sixty-second expiry, so a permission cannot be replayed.',
  'A signing key the agent never holds.',
  'Recording the refusals, not just the actions.',
  'Policy versions that cannot be rolled back quietly.',
  'A breaker for the agent that just keeps trying.',
];

const PATHS: Array<[string, string, string]> = [
  ['HTTP', '1 minute', 'One POST to /api/agents/:id/authorize before the action. No account, no key.'],
  ['MCP', '2 minutes', 'A config block with npx -y chancela-mcp. The model gets a chancela_authorize tool.'],
  ['MetaMask Agent Wallet', '2 minutes', 'The mm-plugin-chancela plugin: mm chancela authorize … && mm transfer …'],
  ['Python', '5 minutes', 'One file. chancela.guard(agent, "PLACE_ORDER", order, …), verified locally.'],
  ['TypeScript SDK', '5 minutes', 'chancela.guard(agent, action, params, () => doIt()) runs only if the permission verifies against the on-chain attestor.'],
  ['Self-hosted', '30 minutes', 'docker compose up. MIT, no call home; point the agent at your own attestor.'],
];

const TIERS = [
  { title: 'Self-hosted', price: 'Free', body: 'Everything in the repository, forever.' },
  {
    title: 'Hosted attestor',
    price: 'Per anchored decision',
    body: 'We run the signing key, the anchoring and the monitoring. An anchor costs about 0.01 MON on testnet, which is what makes per-decision pricing possible at all.',
  },
  {
    title: 'Private attestor for platforms',
    price: 'Per deployment',
    body: 'A dedicated key and deployment for a platform that hosts many agents, with audit exports for its compliance team.',
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The pitch, as a page.
 *
 * The same argument the pitch video makes, for a reader who would rather read:
 * who needs this, why they will not build it, what adopting it costs, how it
 * pays for itself and where it stands. Every claim here is one the README or
 * ADOPTION.md already makes and links evidence for; this page adds no new ones,
 * and it keeps their plain statement that nobody has integrated yet.
 */
export default function PitchPage() {
  return (
    <div className="relative">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[360px]" />
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <PublicHeader />

        <section className="mt-12 max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight">The pitch, in a page.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            An agent with a wallet will eventually be told to do something it should not: by a user, by a
            poisoned web page, by a customer email. Today its limits are a system prompt, or an{' '}
            <span className="mono text-ink">if</span> in the same process the model steers. Neither can be
            checked by anyone else afterwards, and neither stops the transaction once the agent decides to
            send it anyway.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            Chancela is the layer that decides what an agent may do, and proves it. The agent asks before it
            acts. A deterministic policy engine, never the model, answers with a signed permission bound to
            the exact parameters. Every decision, refusals included, is a transaction on Monad that anyone
            can verify without an account.
          </p>
        </section>

        <Section title="Who it is for">
          <div className="grid gap-4 sm:grid-cols-3">
            {WHO.map((w) => (
              <div key={w.title} className="card p-5">
                <h3 className="text-sm font-medium">{w.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{w.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Why they will not write it themselves">
          <p className="max-w-3xl text-[14px] leading-relaxed text-muted">
            Every team writes the first version: an <span className="mono text-ink">if</span> before the tool
            call. What they do not write, because it only matters after something has gone wrong:
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {NOT_WRITTEN.map((item) => (
              <li key={item} className="rounded-md border border-line bg-surface/60 px-3 py-2 text-[13px] text-ink">
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-3xl text-[14px] leading-relaxed text-muted">
            And the home-grown version has one limit no amount of work removes:{' '}
            <span className="text-ink">nobody outside the company can verify it.</span> A policy hash and a
            decision anchored on Monad can be checked by a counterparty without asking anyone.{' '}
            <a href={`${REPO}/blob/main/docs/THREAT_MODEL.md`} target="_blank" rel="noreferrer" className="text-chain hover:underline">
              The threat model lists eighteen attacks of this kind.
            </a>
          </p>
        </Section>

        <Section title="What adopting it costs">
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Path</th>
                  <th className="px-4 py-3 font-medium">Effort</th>
                  <th className="px-4 py-3 font-medium">What the integrator writes</th>
                </tr>
              </thead>
              <tbody>
                {PATHS.map(([path, effort, what]) => (
                  <tr key={path} className="border-t border-line">
                    <td className="whitespace-nowrap px-4 py-3 text-ink">{path}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-chain">{effort}</td>
                    <td className="px-4 py-3 text-muted">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Why Monad">
          <p className="max-w-3xl text-[14px] leading-relaxed text-muted">
            Measured on testnet, one anchored decision is one transaction, 92,478 gas, about 0.009 MON, in
            sub-second blocks. That is what makes it affordable to record every decision, refusals included,
            while the agent is still waiting for its answer. On a slower or dearer chain this gets batched
            into a daily Merkle root and the per-action proof is gone. When a human must decide, they approve
            with a passkey, and Monad verifies that signature itself through its P-256 precompile.
          </p>
        </Section>

        <Section title="How it sustains itself">
          <p className="max-w-3xl text-[14px] leading-relaxed text-muted">
            The protocol is and stays open: MIT code, a registry contract with no admin, and an attestor the
            agent&apos;s owner can replace in one transaction. So what can be sold is not access; it is running
            the attestor well.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {TIERS.map((t) => (
              <div key={t.title} className="card p-5">
                <div className="text-[11px] uppercase tracking-wider text-faint">{t.price}</div>
                <h3 className="mt-1 text-sm font-medium">{t.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{t.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-faint">
            The constraint we hold ourselves to: nothing in the paid tiers can make an agent dependent on us.
            An owner who leaves takes their identity, policy history and audit trail with them, because none
            of it was ever ours.
          </p>
        </Section>

        <Section title="Where it stands, plainly">
          <ul className="max-w-3xl space-y-2 text-[14px] leading-relaxed text-muted">
            <li>
              <span className="text-ink">Live:</span> this deployment on Monad testnet, open without an account;
              the contracts and one agent on Monad mainnet since 3 October 2026.
            </li>
            <li>
              <span className="text-ink">Published:</span> the SDK, the MCP server, the MetaMask plugin and a
              one-command check on npm.
            </li>
            <li>
              <span className="text-ink">Integrations by other teams: one live.</span> MonFunded, a
              prop-trading product, has its order bot asking Chancela before every order, each decision
              anchored on Monad testnet since 7 October 2026; the volume so far is their integration testing.{' '}
              <a href={`${REPO}/blob/main/docs/ADOPTION.md`} target="_blank" rel="noreferrer" className="text-chain hover:underline">
                The adoption notes keep the dated record.
              </a>
            </li>
            <li>
              <span className="text-ink">Next:</span> three design partners, policy templates, and moving the
              app and its audit anchors to mainnet.
            </li>
          </ul>
        </Section>

        <Section title="Who builds it">
          <p className="max-w-3xl text-[14px] leading-relaxed text-muted">
            David Matheus Souza, in Brazil, with a background in infrastructure, support and automation: the
            side of IT that gets the call when an automated system does something nobody approved. Chancela
            comes from there. If agents are going to act on their own, the question after an incident is
            always the same: who allowed this, under which rule, and can you prove it? Today the only answer
            is the operator&apos;s own log. Built alone during the Metropolis build window.
          </p>
        </Section>

        <section className="mt-14 flex flex-wrap items-center gap-3">
          <a href="/demo" className="lift inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-bg">
            Run the demo <ArrowRight className="h-3.5 w-3.5" />
          </a>
          <Link href="/live" className="lift inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-ink">
            Watch the live ledger
          </Link>
          <a href={REPO} target="_blank" rel="noreferrer" className="lift inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-ink">
            Read the code
          </a>
          <span className="mono text-[12px] text-faint">or, from your own machine: npx chancela-check</span>
        </section>

        <PublicFooter />
      </div>
    </div>
  );
}
