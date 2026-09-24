import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, CircleDashed, ExternalLink, XCircle } from 'lucide-react';
import { REASON_TEXT, type ReasonCode } from '@chancela/shared';
import { PublicHeader } from '@/components/public-header';
import { DecisionPill, Label, Mono, RiskPill } from '@/components/primitives';
import { getRepository } from '@/lib/store';
import { findDecision, recomputeDecisionHash } from '@/lib/proof';
import { explorerAddressUrl, explorerTxUrl, readAnchor } from '@/lib/chain';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }) {
  return {
    title: `Proof ${params.id} - Chancela`,
    description: 'One AI agent decision, recomputed and checked against Monad.',
    robots: { index: false, follow: false },
  };
}

type Check = { label: string; detail: string; state: 'pass' | 'fail' | 'pending' };

/**
 * One decision's proof, for a person rather than a program.
 *
 * `/api/proofs/:id` already serves the raw material. This page does the
 * checking a reader would otherwise do by hand, and does it against the chain
 * on every load: the hash is recomputed from the capsule, and the anchoring
 * transaction is fetched from Monad and decoded, so "anchored" means the hash
 * Monad executed, not a status column in our database.
 */
export default async function ProofPage({ params }: { params: { id: string } }) {
  const repo = await getRepository();
  const decision = await findDecision(repo, decodeURIComponent(params.id));
  if (!decision) notFound();

  const [agent, onchain] = await Promise.all([
    repo.getAgent(decision.agentId),
    decision.onchainTxHash ? readAnchor(decision.onchainTxHash) : Promise.resolve(null),
  ]);

  const recomputed = recomputeDecisionHash(decision);
  const same = (a?: string | null, b?: string | null) => Boolean(a && b) && a!.toLowerCase() === b!.toLowerCase();

  const checks: Check[] = [
    {
      label: 'The record is intact',
      detail: 'Decision hash recomputed from the signed capsule just now matches the stored one.',
      state: same(recomputed, decision.decisionHash) ? 'pass' : 'fail',
    },
  ];
  if (!decision.onchainTxHash) {
    checks.push({
      label: 'Anchored on Monad',
      detail:
        decision.anchorStatus === 'PENDING'
          ? 'The anchoring transaction is still in flight.'
          : 'This decision was not anchored (no chain configured, or the anchor budget was spent).',
      state: 'pending',
    });
  } else if (!onchain) {
    checks.push({
      label: 'Anchored on Monad',
      detail: 'Monad could not be reached to re-read the transaction. Reload, or check the explorer link.',
      state: 'pending',
    });
  } else {
    checks.push(
      {
        label: 'Anchored on Monad',
        detail: `Transaction succeeded in block ${onchain.blockNumber}, calling recordDecision on the policy registry.`,
        state: onchain.ok ? 'pass' : 'fail',
      },
      {
        label: 'The chain holds this exact decision',
        detail: 'The decision hash decoded from the transaction Monad executed equals this record’s hash.',
        state: same(onchain.decisionHash, decision.decisionHash) ? 'pass' : 'fail',
      },
      {
        label: 'Same intent, same policy',
        detail: 'Intent hash and policy hash on-chain match what this decision was made against.',
        state:
          same(onchain.intentHash, decision.intentHash) && same(onchain.policyHash, decision.policyHash)
            ? 'pass'
            : 'fail',
      },
    );
  }

  const failed = checks.some((c) => c.state === 'fail');
  const verified = checks.every((c) => c.state === 'pass');
  const reason = REASON_TEXT[decision.reasonCode as ReasonCode] ?? decision.reasonCode;
  const txUrl = decision.onchainTxHash ? explorerTxUrl(decision.onchainTxHash) : null;

  return (
    <div className="relative">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[360px]" />
      <div className="relative mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <PublicHeader />

        <div className="mt-12">
          <Link href="/live" className="text-[12px] text-faint hover:text-ink">
            ← Live ledger
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DecisionPill decision={decision.outcome} />
            <RiskPill risk={decision.risk} />
            <Mono className="text-faint">{decision.auditId}</Mono>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            <span className="mono text-[26px]">{decision.action}</span>
            <span className="text-muted">
              {' '}
              {decision.outcome === 'DENY' ? 'refused' : decision.outcome === 'ALLOW' ? 'authorized' : 'held for its owner'}
            </span>
          </h1>
          <p className="mt-2 text-[15px] text-muted">
            {reason} Agent{' '}
            <span className="text-ink">{agent?.name ?? decision.agentId}</span>{' '}
            <Mono>({decision.agentId})</Mono>, policy v{decision.policyVersion},{' '}
            {new Date(decision.createdAt).toUTCString()}.
          </p>
        </div>

        <section
          className={`card mt-8 overflow-hidden ${failed ? 'border-deny/60' : verified ? 'border-allow/40' : ''}`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <span className="text-sm font-medium">
              {failed ? 'This proof does not hold' : verified ? 'Verified against Monad' : 'Partly verified'}
            </span>
            <span className="text-[11px] text-faint">checked on this page load</span>
          </div>
          <ul className="divide-y divide-line">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-3 px-5 py-3.5">
                {c.state === 'pass' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-allow" aria-label="passed" />
                ) : c.state === 'fail' ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-deny" aria-label="failed" />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-label="not checked" />
                )}
                <div className="min-w-0">
                  <div className="text-sm text-ink">{c.label}</div>
                  <div className="mt-0.5 text-[12.5px] text-muted">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card mt-4 p-5">
          <dl className="grid gap-4 text-[12px]">
            <Row label="Decision hash" value={decision.decisionHash} />
            <Row label="Intent hash" value={decision.intentHash} hint="Commits to the exact parameters; a changed amount or recipient changes it." />
            <Row label="Policy hash" value={decision.policyHash} />
            <Row label="Attestor signature" value={decision.signature} />
            {onchain && (
              <Row label="Anchored by" value={onchain.from} href={explorerAddressUrl(onchain.from)} />
            )}
            {txUrl && <Row label="Monad transaction" value={decision.onchainTxHash!} href={txUrl} />}
          </dl>
        </section>

        <section className="mt-8">
          <h2 className="text-[15px] font-semibold tracking-tight">Check it without us</h2>
          <p className="mt-1 text-[13px] text-muted">
            This page is a convenience. The same checks run from a terminal against Monad directly.
          </p>
          <pre className="mono card mt-3 whitespace-pre-wrap p-4 text-[11.5px] leading-relaxed text-ink [overflow-wrap:anywhere]">
            {`# the signed capsule and its recomputed hash
curl https://chancela.xyz/api/proofs/${decision.auditId}
${
  decision.onchainTxHash
    ? `
# what Monad executed: decode the calldata of the anchoring transaction
cast tx ${decision.onchainTxHash} input --rpc-url https://testnet-rpc.monad.xyz \\
  | cast calldata-decode "recordDecision((uint256,bytes32,bytes32,bytes4,uint8,uint8,bytes32))"`
    : ''
}`}
          </pre>
        </section>

        <footer className="mt-16 border-t border-line pt-6 text-xs text-faint">
          Only hashes and references are public. Parameters, prompts and model output never leave the service.
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value, href, hint }: { label: string; value: string; href?: string; hint?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mono mt-1 text-[11.5px] text-ink [overflow-wrap:anywhere]">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-chain">
            {value} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          value
        )}
      </div>
      {hint && <div className="mt-0.5 text-[11.5px] text-faint">{hint}</div>}
    </div>
  );
}
