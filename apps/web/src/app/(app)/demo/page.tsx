import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession } from '@/lib/session';
import { ownsAgent } from '@/lib/owner';
import { PERMISSIONS } from '@chancela/shared';
import { getRepository } from '@/lib/store';
import { activeChain, chainConfig } from '@/lib/chain';
import { Badge, Mono } from '@/components/primitives';
import { DemoRunner, type DemoAgent } from './demo-runner';

export const dynamic = 'force-dynamic';

const DEMO_AGENT = 'TA-001';

/**
 * The guided demonstration.
 *
 * It runs against the live system rather than a script: the agent, its policy
 * and its permissions are read from the same store every other screen reads,
 * and the steps call the same endpoints the console calls. If the policy is
 * edited, this page changes with it -- which is the point, since a demo that
 * cannot go wrong is not evidence of anything.
 */
export default async function DemoPage() {
  const repo = await getRepository();
  const record = await repo.getAgent(DEMO_AGENT);
  if (!record) notFound();

  const policy = await repo.getActivePolicy(DEMO_AGENT);
  const granted = policy?.document.permissions ?? [];

  const agent: DemoAgent = {
    id: record.id,
    name: record.name,
    ownerAddress: record.ownerAddress,
    walletAddress: record.walletAddress,
    erc8004TokenId: record.erc8004TokenId,
    status: record.status,
    policyVersion: policy?.version ?? 0,
    policyName: policy?.name ?? 'none',
    granted: [...granted],
    blocked: PERMISSIONS.filter((p) => !granted.includes(p)),
  };

  // The breaker step suspends the agent, and only its owner can bring it back.
  // Someone who signed up with their own passkey a minute ago is not that
  // owner, and letting them trip it would leave the demo broken for everyone.
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  const canAdminister = ownsAgent(session, record);

  const chain = activeChain();
  const anchoring = Boolean(chainConfig());

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Chancela, in two minutes</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-muted">
            An AI agent proposes. A deterministic policy engine decides. Monad keeps the record —
            including of what was refused.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={anchoring ? 'chain' : 'warn'}>
            {anchoring ? chain.name : 'Anchoring disabled'}
          </Badge>
          <Mono className="text-faint">chain {chain.id}</Mono>
        </div>
      </header>

      <DemoRunner agent={agent} canAdminister={canAdminister} />

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="label">How it works</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-[12.5px]">
          {[
            'AI agent',
            'Intent',
            'Policy',
            'Risk',
            'Allow / Deny',
            'Action',
            'Audit',
            'Monad proof',
          ].map((s, i, all) => (
            <span key={s} className="flex items-center gap-2">
              <span
                className={
                  s === 'Policy'
                    ? 'text-allow'
                    : s === 'Monad proof'
                      ? 'text-chain'
                      : 'text-muted'
                }
              >
                {s}
              </span>
              {i < all.length - 1 ? <span className="text-faint">&rarr;</span> : null}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-faint">
          The model never reaches the action layer. It produces a structured intent and stops; every
          gate after that is deterministic, and the default at the bottom is refusal.
        </p>
      </section>
    </div>
  );
}
