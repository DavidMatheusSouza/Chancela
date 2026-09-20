'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Fingerprint, Loader2 } from 'lucide-react';
import { Badge, Field, Label, Mono } from '@/components/primitives';
import { formatTime, shortHash } from '@/lib/ui';

interface StepUp {
  decision: string;
  reasonText: string;
  risk: string;
  auditId: string;
  decisionHash: string;
  approval?: { id: string; expiresAt: string };
}

interface Showcase {
  resolvedAt: string | null;
  request: { agentId: string; action: string; auditId: string; decisionHash: string } | null;
  onchain: { txHash: string | null; explorerUrl: string | null };
  decision: { auditId: string; reasonText: string } | null;
}

const TRANSFER = { amount: 50_000, currency: 'USD', recipient: 'Acme Supplies', memo: 'Invoice 2026-091' };

/**
 * Step-up, live.
 *
 * The treasury agent asks to move $500. Its policy grants that -- and says a
 * human decides. The request below is real and is now waiting for the agent's
 * owner. A visitor cannot approve it: they do not hold the owner's passkey,
 * which is the whole point. So beside it is the last approval the owner really
 * gave, with the transaction in which Monad verified the passkey signature.
 */
export function HumanApproval() {
  const [stepUp, setStepUp] = useState<StepUp | null>(null);
  const [showcase, setShowcase] = useState<Showcase | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [asked, shown] = await Promise.all([
          fetch('/api/agents/TA-003/authorize', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'TRANSFER_FUNDS', parameters: TRANSFER }),
          }).then((r) => r.json()),
          fetch('/api/approvals/showcase', { cache: 'no-store' }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (asked?.error) throw new Error(asked.error.message);
        setStepUp(asked);
        setShowcase(shown?.approval ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The request failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="mt-4 text-[13px] text-deny">{error}</p>;
  if (!stepUp) {
    return (
      <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> TreasuryAgent is asking to transfer $500…
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-lg border border-warn/40 bg-warn/[0.05] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warn">{stepUp.decision === 'REQUIRE_APPROVAL' ? 'needs the owner' : stepUp.decision}</Badge>
          <span className="text-[14px] font-medium">TA-003 · TRANSFER_FUNDS · $500.00 to Acme Supplies</span>
          <Badge tone="deny">{stepUp.risk}</Badge>
        </div>
        <p className="mt-2 text-[13px] text-muted">
          {stepUp.reasonText} The permission exists and the limits hold; the policy still hands this
          one to a person. Nothing runs until they answer.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field label="Decision to be signed" value={shortHash(stepUp.decisionHash, 12, 8)} mono />
          <Field label="Audit" value={stepUp.auditId} mono />
          <Field label="Waits until" value={stepUp.approval ? formatTime(stepUp.approval.expiresAt) : '--'} />
        </div>
        <p className="mt-3 text-[12.5px] text-faint">
          You cannot approve it, and neither can this service: approving means signing that hash with
          the owner&apos;s passkey, and only their device holds it.
        </p>
      </div>

      <div className="rounded-lg border border-chain/30 bg-chain/[0.04] p-4">
        <Label>
          <span className="inline-flex items-center gap-1.5">
            <Fingerprint className="h-3.5 w-3.5" /> The last time the owner did
          </span>
        </Label>
        {showcase === undefined ? null : showcase === null ? (
          <p className="mt-2 text-[13px] text-muted">No approval has been verified on-chain yet.</p>
        ) : (
          <>
            <p className="mt-2 text-[13px] text-muted">
              {showcase.request?.agentId} · {showcase.request?.action}, approved{' '}
              {showcase.resolvedAt ? formatTime(showcase.resolvedAt) : ''} with a passkey. The WebAuthn
              signature was checked here, then checked again by a contract using Monad&apos;s native P-256
              precompile — about 82,000 gas.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="Decision signed" value={shortHash(showcase.request?.decisionHash, 12, 8)} mono />
              <Field label="Became" value={showcase.decision ? `ALLOW · ${showcase.decision.auditId}` : '--'} mono />
              <Field
                label="Verified on Monad"
                value={
                  showcase.onchain.explorerUrl ? (
                    <a href={showcase.onchain.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-chain hover:underline">
                      <Mono>{shortHash(showcase.onchain.txHash, 10, 6)}</Mono>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    '--'
                  )
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
