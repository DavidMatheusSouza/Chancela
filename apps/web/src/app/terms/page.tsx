import { PublicHeader } from '@/components/public-header';
import { PublicFooter } from '@/components/public-footer';

// Rendered per request, like the other public pages: a prerendered page is sent
// with a year of s-maxage, and the edge would keep serving it after the text changed.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Terms - Chancela',
  description: 'What the chancela.xyz deployment is, what it is not, and the terms it is offered under.',
  alternates: { canonical: '/terms' },
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

export default function TermsPage() {
  return (
    <div className="relative">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[360px]" />
      <div className="relative mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <PublicHeader />

        <section className="mt-12">
          <h1 className="text-4xl font-semibold tracking-tight">Terms</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            These terms cover the deployment at chancela.xyz, run by David Matheus Souza, in Brazil. Last
            updated 7 October 2026.
          </p>
        </section>

        <Section title="What this is">
          <p>
            Chancela decides whether an AI agent may take an action, signs the answer and records it on
            Monad. This deployment is a hackathon project running against the Monad testnet. Testnet tokens
            have no monetary value.
          </p>
        </Section>

        <Section title="What this is not">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>It is not an exchange, a broker, a wallet or a custodian. It holds no user funds.</li>
            <li>It sells nothing: no token, no investment, no subscription. Nothing on the site is financial advice.</li>
            <li>It never asks for a seed phrase or a private key. Anyone asking for one in its name is not us.</li>
          </ul>
        </Section>

        <Section title="Using it">
          <p>
            You may read the public pages, call the public API and create agents for your own use. Do not
            use the service to break the law, to attack other people&apos;s systems, or to overload this
            one. The live ledger&apos;s attack buttons exist to be pressed; they run fixed, harmless
            attempts against a demo agent.
          </p>
          <p>
            You are responsible for the agents you register and for what they do. A decision from Chancela
            is a check your agent chose to ask for, not a guarantee about the action it takes afterwards.
          </p>
        </Section>

        <Section title="No warranty">
          <p>
            The software is provided under the{' '}
            <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="text-chain hover:underline">
              MIT license
            </a>
            , as is, without warranty of any kind. This deployment may be changed, reset or taken offline at
            any time. Do not rely on it for anything you cannot afford to lose; for that, run your own copy.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions and removal requests:{' '}
            <a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="text-chain hover:underline">
              GitHub issues
            </a>
            . Security reports: a{' '}
            <a href={`${REPO}/security/advisories/new`} target="_blank" rel="noreferrer" className="text-chain hover:underline">
              private security advisory
            </a>
            , not a public issue.
          </p>
        </Section>

        <PublicFooter />
      </div>
    </div>
  );
}
