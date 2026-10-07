import { PublicHeader } from '@/components/public-header';
import { PublicFooter } from '@/components/public-footer';

// Rendered per request, like the other public pages: a prerendered page is sent
// with a year of s-maxage, and the edge would keep serving it after the text changed.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Privacy - Chancela',
  description: 'What chancela.xyz stores, what it sends to others, what is public on Monad, and how to have it removed.',
  alternates: { canonical: '/privacy' },
};

const REPO = 'https://github.com/DavidMatheusSouza/Chancela';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/**
 * What this deployment keeps, written from the schema rather than from a
 * template. If a field is added to the database, it belongs on this page.
 */
export default function PrivacyPage() {
  return (
    <div className="relative">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[360px]" />
      <div className="relative mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <PublicHeader />

        <section className="mt-12">
          <h1 className="text-4xl font-semibold tracking-tight">Privacy</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            Chancela is an open-source authorization layer for AI agents. This page covers the deployment at
            chancela.xyz, which is run by David Matheus Souza, in Brazil, as a hackathon project on the Monad
            testnet. Last updated 7 October 2026.
          </p>
        </section>

        <Section title="Reading the site needs nothing from you">
          <p>
            The landing page, the live ledger, proof pages and agent passports are public. They set no
            cookie, ask for no wallet and load no analytics, advertising or tracking scripts.
          </p>
        </Section>

        <Section title="What is stored when you sign in">
          <p>
            Signing in is only needed to manage your own agents. You can sign in with a wallet signature, a
            passkey, or an email address through Privy. The service then stores:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>your owner address, which is the public address of the wallet or account you signed in with;</li>
            <li>your email address, only if you chose email sign-in;</li>
            <li>the public key of a passkey you register. The private key never leaves your device;</li>
            <li>the agents and policies you create, and the decisions made for those agents;</li>
            <li>one session cookie, <span className="mono text-ink">chancela_session</span>, used only to keep you signed in.</li>
          </ul>
          <p>
            The site never asks for a seed phrase or a private key, and signing in is a signed message, not a
            transaction: it cannot move funds or approve a token.
          </p>
        </Section>

        <Section title="What an agent sends">
          <p>
            An agent that calls the authorize endpoint sends the action it wants to take and its parameters.
            These are stored so the decision can be audited by the agent&apos;s owner. For agents that are
            not public demo agents, only hashes, the action name, the outcome and the reason are shown
            publicly; parameters and prompts are not.
          </p>
        </Section>

        <Section title="What is public on Monad, permanently">
          <p>
            Each decision for a registered agent is anchored on the Monad testnet as hashes: the agent&apos;s
            token id, the policy hash and the decision hash. A blockchain record cannot be edited or deleted
            by anyone, including us. It contains no names, emails or parameters.
          </p>
        </Section>

        <Section title="Who else sees data">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Cloudflare sits in front of the site and sees requests, including IP addresses, as any CDN does.</li>
            <li>Privy handles email and embedded-wallet sign-in, if you use it.</li>
            <li>
              In the guided demo, the text typed for the demo agent is sent to a language-model provider to
              be read as an intended action. The decision itself is made by rules, not by the model.
            </li>
            <li>A wallet address may be checked against a risk-label provider before a transfer is allowed.</li>
          </ul>
          <p>Nothing is sold, and nothing is shared for advertising.</p>
        </Section>

        <Section title="Rate limiting">
          <p>
            IP addresses are used in memory to limit how often one visitor can call the public endpoints.
            They are not written to the database.
          </p>
        </Section>

        <Section title="Removing your data">
          <p>
            To have your account, agents and stored decisions deleted, open an issue at{' '}
            <a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="text-chain hover:underline">
              github.com/DavidMatheusSouza/Chancela
            </a>{' '}
            naming your owner address. Hashes already anchored on Monad stay there. You can also run the
            whole service yourself: the code is MIT-licensed and does not call home.
          </p>
        </Section>

        <PublicFooter />
      </div>
    </div>
  );
}
