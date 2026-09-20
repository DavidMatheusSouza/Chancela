import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, KeyRound, Wallet } from 'lucide-react';
import { PERMISSIONS, PERMISSION_LABELS, REASON_TEXT } from '@chancela/shared';
import { getRepository } from '@/lib/store';
import { computeTrustScore } from '@/lib/trust-score';
import { activeChain, explorerAddressUrl, explorerTxUrl, onchainAgentWallet } from '@/lib/chain';
import { Badge, Card, Field, Label, Mono, StatusDot } from '@/components/primitives';
import { DecisionHistory } from '@/components/decision-history';
import { SuspendedBanner } from '@/components/suspended-banner';
import { cn, formatTime, shortHash } from '@/lib/ui';

export const dynamic = 'force-dynamic';

/**
 * Agent Passport.
 *
 * The one screen that has to land in five seconds: who this agent is, who owns
 * it, what it may do, and -- given equal weight -- what it may not.
 */
export default async function AgentPassport({ params }: { params: { id: string } }) {
  const repo = await getRepository();
  const agent = await repo.getAgent(params.id);
  if (!agent) notFound();

  const policy = await repo.getActivePolicy(params.id);
  const decisions = await repo.listDecisions({ agentId: params.id, limit: 200 });
  const trust = computeTrustScore({
    hasVerifiedOwner: Boolean(agent.erc8004TokenId),
    policyVersion: policy?.version ?? 1,
    decisions,
  });

  const granted = new Set(policy?.document.permissions ?? []);
  const chain = activeChain();

  // What the registry says, next to what we say. Null is "could not ask".
  const registered =
    agent.erc8004TokenId && agent.walletAddress ? await onchainAgentWallet(agent.erc8004TokenId) : null;
  const walletOnchain =
    registered === null ? null : registered.toLowerCase() === agent.walletAddress?.toLowerCase();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <Link href="/agents" className="text-xs text-muted hover:text-ink">
          &larr; Agents
        </Link>
        <div className="flex gap-2">
          <Link href={`/agents/${agent.id}/console`} className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-bg hover:opacity-90">
            Open console
          </Link>
          <Link href={`/agents/${agent.id}/policy`} className="rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-surface">
            Edit policy
          </Link>
        </div>
      </div>

      {agent.status === 'SUSPENDED' ? <SuspendedBanner agentId={agent.id} name={agent.name} /> : null}

      {/* The single spotlight element on the whole product. */}
      <Card className="relative overflow-hidden border-chain/20 glow-chain">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-chain/10 blur-3xl" />
        <div className="relative space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-[22px] font-semibold tracking-tight">{agent.name}</h1>
                {agent.erc8004TokenId ? <Badge tone="chain">Verified - ERC-8004 #{agent.erc8004TokenId}</Badge> : <Badge>Unregistered</Badge>}
              </div>
              <p className="mt-1.5 max-w-xl text-[13px] text-muted">{agent.description}</p>
            </div>
            <div className="text-right">
              <Label>Trust score</Label>
              <div className={cn('text-3xl font-semibold tabular-nums', trust.score >= 70 ? 'text-allow' : 'text-warn')}>
                {trust.score}
              </div>
            </div>
          </div>

          <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-4">
            <Field label="Agent ID" value={agent.id} mono />
            <Field label="Owner" value={shortHash(agent.ownerAddress, 8, 6)} mono />
            <Field
              label="Agent wallet"
              value={
                agent.walletAddress ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <a href={explorerAddressUrl(agent.walletAddress)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-chain hover:underline">
                      {shortHash(agent.walletAddress, 8, 6)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {walletOnchain === null ? null : walletOnchain ? (
                      <Badge tone="chain">in registry</Badge>
                    ) : (
                      <Badge tone="warn">not in registry</Badge>
                    )}
                  </span>
                ) : (
                  '--'
                )
              }
              mono
            />
            <Field
              label="Status"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone={agent.status === 'ACTIVE' ? 'allow' : 'deny'} live={agent.status === 'ACTIVE'} />
                  {agent.status}
                </span>
              }
            />
          </div>

          <div className="grid gap-5 border-t border-line pt-5 sm:grid-cols-4">
            <Field label="Policy" value={policy ? `${policy.name} v${policy.version}` : 'None'} />
            <Field label="Policy hash" value={shortHash(policy?.policyHash, 10, 6)} mono />
            <Field
              label="Key derivation"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-muted" />
                  {agent.walletProvider === 'MERA' ? `passkey / m/44'/60'/0'/0/${agent.derivationIndex}` : agent.walletProvider ?? '--'}
                </span>
              }
              mono
            />
            <Field
              label="Network"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 text-muted" />
                  {chain.name}
                </span>
              }
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Permissions</h2>
            <Mono className="text-faint">{granted.size} granted / {PERMISSIONS.length - granted.size} blocked</Mono>
          </div>
          <ul className="space-y-1.5">
            {PERMISSIONS.map((code) => {
              const has = granted.has(code);
              return (
                <li key={code} className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]', has ? 'bg-allow/[0.05]' : 'bg-deny/[0.04]')}>
                  <span className={cn('mono text-sm', has ? 'text-allow' : 'text-deny')}>{has ? '✓' : '✕'}</span>
                  <span className={has ? 'text-ink' : 'text-faint line-through decoration-deny/40'}>{PERMISSION_LABELS[code]}</span>
                  <Mono className="ml-auto text-faint">{code}</Mono>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3">
            <h2 className="text-sm font-medium">Trust score breakdown</h2>
            <ul className="space-y-1.5">
              {trust.factors.map((f) => (
                <li key={f.label} className="flex items-center justify-between text-[13px]">
                  <span className="text-muted">{f.label}</span>
                  <span className={cn('mono tabular-nums', f.points >= 0 ? 'text-allow' : 'text-deny')}>
                    {f.points >= 0 ? '+' : ''}{f.points}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line pt-3 text-[12px] leading-relaxed text-faint">
              The score informs humans. It is never consulted by the policy engine -- a score that
              could authorize would be a score worth attacking.
            </p>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-medium">Limits</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Max transaction" value={`$${((policy?.document.limits.maxTransactionValue ?? 0) / 100).toFixed(2)}`} mono />
              <Field label="Daily transactions" value={policy?.document.limits.dailyTransactions ?? 0} mono />
              <Field label="Daily value cap" value={`$${((policy?.document.limits.dailyValueCap ?? 0) / 100).toFixed(2)}`} mono />
              <Field label="Step-up at" value={policy?.document.stepUpThreshold ?? '--'} mono />
            </div>
          </Card>
        </div>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Decision history</h2>
          <Mono className="text-faint">
            {decisions.filter((d) => d.outcome === 'DENY').length} of {decisions.length} refused
          </Mono>
        </div>
        <DecisionHistory
          entries={decisions.slice(0, 12).map((d) => ({
            id: d.id,
            action: d.action,
            outcome: d.outcome,
            risk: d.risk,
            reasonText: REASON_TEXT[d.reasonCode as keyof typeof REASON_TEXT] ?? d.reasonCode,
            policyVersion: d.policyVersion,
            decisionHash: d.decisionHash,
            txUrl: d.onchainTxHash ? explorerTxUrl(d.onchainTxHash) : null,
            anchorStatus: d.anchorStatus,
            time: formatTime(d.createdAt),
          }))}
        />
      </Card>
    </div>
  );
}
