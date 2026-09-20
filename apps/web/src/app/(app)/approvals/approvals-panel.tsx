'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, Fingerprint, Loader2, ShieldAlert } from 'lucide-react';
import { Badge, Card, Empty, Field, Label, Mono } from '@/components/primitives';
import { passkeyErrorText } from '@/lib/passkey-keys';
import { cn, formatTime, shortHash } from '@/lib/ui';

interface ApprovalView {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  request: {
    agentId: string;
    action: string;
    risk: string;
    reasonText: string;
    auditId: string;
    decisionHash: string;
    challenge: string;
    parameters?: Record<string, unknown>;
  } | null;
  onchain: { status: string; txHash: string | null; explorerUrl: string | null; note: string | null };
  decision: { auditId: string; reasonText: string } | null;
}

const b64url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function ApprovalsPanel({
  approvals,
  approver,
  sharedDemo,
}: {
  approvals: ApprovalView[];
  approver: { credentialId: string; x: string; createdAt: string } | null;
  sharedDemo: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enrol() {
    setError(null);
    setBusy('enrol');
    try {
      const created = (await navigator.credentials.create({
        publicKey: {
          rp: { id: location.hostname, name: 'Chancela' },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: `approver-${Date.now()}`,
            displayName: 'Chancela approver',
          },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          // ES256 only: it is the curve Monad's precompile verifies.
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
          attestation: 'none',
          hints: ['client-device', 'hybrid', 'security-key'],
        } as PublicKeyCredentialCreationOptions,
      })) as PublicKeyCredential | null;
      const spki = (created?.response as AuthenticatorAttestationResponse | undefined)?.getPublicKey?.();
      if (!created || !spki) throw new Error('passkey creation returned no public key');

      const res = await fetch('/api/approver', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          credentialId: b64url(created.rawId),
          publicKeySpki: b64url(spki),
          // /approvals?enrol=<code>: how the operator enrols for the shared demo account.
          enrolmentCode: new URLSearchParams(location.search).get('enrol') ?? undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not enrol the passkey');
      router.refresh();
    } catch (err) {
      setError(passkeyErrorText(err, 'Could not enrol the passkey'));
    } finally {
      setBusy(null);
    }
  }

  async function approve(item: ApprovalView) {
    if (!item.request || !approver) return;
    setError(null);
    setBusy(item.id);
    try {
      // The challenge IS the decision hash. What the authenticator signs is what
      // the server checks and what the contract checks: this decision, nothing else.
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: fromB64url(item.request.challenge),
          rpId: location.hostname,
          allowCredentials: [{ type: 'public-key', id: fromB64url(approver.credentialId) }],
          userVerification: 'required',
        },
      })) as PublicKeyCredential | null;
      if (!assertion) throw new Error('passkey operation cancelled');
      const response = assertion.response as AuthenticatorAssertionResponse;

      const res = await fetch(`/api/approvals/${item.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          credentialId: b64url(assertion.rawId),
          authenticatorData: b64url(response.authenticatorData),
          clientDataJSON: b64url(response.clientDataJSON),
          signature: b64url(response.signature),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'The approval was refused');
      router.refresh();
      // The on-chain verification lands a few seconds later; pick it up.
      setTimeout(() => router.refresh(), 7000);
    } catch (err) {
      setError(passkeyErrorText(err, 'The approval was refused'));
    } finally {
      setBusy(null);
    }
  }

  const pending = approvals.filter((a) => a.status === 'PENDING');
  const past = approvals.filter((a) => a.status !== 'PENDING');

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label>Approver passkey</Label>
            <p className="mt-1 text-[13px] text-muted">
              {approver ? (
                <>
                  Enrolled {formatTime(approver.createdAt)} · public key <Mono>{shortHash(approver.x, 10, 6)}</Mono>
                </>
              ) : sharedDemo ? (
                'This is the shared demo account, so it cannot enrol an approver — one visitor would approve for everyone. Create an account with a passkey on the sign-in page to try it with your own agent.'
              ) : (
                'Enrol the passkey you will approve with. Its P-256 public key is what gets registered on-chain.'
              )}
            </p>
          </div>
          {/* Offered to the shared demo account too: the server decides, and says why not. */}
          {!(sharedDemo && approver) ? (
            <button
              onClick={() => void enrol()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] hover:bg-bg disabled:opacity-50"
            >
              {busy === 'enrol' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              {approver ? 'Replace passkey' : 'Enrol a passkey'}
            </button>
          ) : null}
        </div>
      </Card>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-deny/40 bg-deny/[0.06] px-3 py-2 text-[13px] text-deny">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <section className="space-y-3">
        <Label>Waiting for you</Label>
        {pending.length === 0 ? (
          <Empty
            title="Nothing to approve"
            hint="A request appears here when a policy answers REQUIRE_APPROVAL — for example a transfer by an agent whose step-up threshold it reaches."
          />
        ) : (
          pending.map((item) => (
            <Card key={item.id} className="border-warn/30">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge tone="warn">needs approval</Badge>
                    <span className="text-[15px] font-medium">
                      {item.request?.agentId} · {item.request?.action}
                    </span>
                    <Badge tone="deny">{item.request?.risk}</Badge>
                  </div>
                  <p className="text-[13px] text-muted">{item.request?.reasonText}</p>
                </div>
                <button
                  onClick={() => void approve(item)}
                  disabled={busy !== null || !approver}
                  title={approver ? undefined : 'Enrol an approver passkey first'}
                  className="inline-flex items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
                >
                  {busy === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                  Approve with passkey
                </button>
              </div>
              <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
                <Field label="You are signing" value={shortHash(item.request?.decisionHash, 12, 8)} mono />
                <Field label="Audit" value={item.request?.auditId ?? '--'} mono />
                <Field label="Expires" value={formatTime(item.expiresAt)} />
              </div>
              {item.request?.parameters ? (
                <pre className="mono mt-3 overflow-x-auto rounded-md border border-line bg-bg px-3 py-2 text-[12px] text-muted">
                  {JSON.stringify(item.request.parameters, null, 2)}
                </pre>
              ) : null}
            </Card>
          ))
        )}
      </section>

      <section className="space-y-3">
        <Label>Answered</Label>
        {past.length === 0 ? (
          <p className="text-[13px] text-faint">No approvals yet.</p>
        ) : (
          past.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {item.status === 'APPROVED' ? (
                    <Badge tone="allow">
                      <Check className="h-3 w-3" /> approved
                    </Badge>
                  ) : (
                    <Badge>expired</Badge>
                  )}
                  <span className="text-[14px]">
                    {item.request?.agentId} · {item.request?.action}
                  </span>
                  <Mono className="text-faint">{item.request?.auditId}</Mono>
                </div>
                <div className={cn('flex items-center gap-2 text-[12.5px]', item.onchain.status === 'CONFIRMED' ? 'text-chain' : 'text-muted')}>
                  {item.status !== 'APPROVED' ? null : item.onchain.status === 'CONFIRMED' && item.onchain.explorerUrl ? (
                    <a href={item.onchain.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      passkey signature verified on Monad <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : item.onchain.status === 'PENDING' ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> verifying on Monad
                    </span>
                  ) : (
                    <span title={item.onchain.note ?? undefined}>on-chain: {item.onchain.status.toLowerCase()}{item.onchain.note ? ` — ${item.onchain.note}` : ''}</span>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
