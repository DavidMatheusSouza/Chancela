import { cookies } from 'next/headers';
import { describeApproval } from '@/lib/approval-view';
import { settleExpiry } from '@/lib/approvals';
import { approvalsAddress, explorerAddressUrl } from '@/lib/chain';
import { isSharedDemoOwner } from '@/lib/demo-signin';
import { SESSION_COOKIE, readSession } from '@/lib/session';
import { getRepository } from '@/lib/store';
import { Badge } from '@/components/primitives';
import { ApprovalsPanel } from './approvals-panel';

export const dynamic = 'force-dynamic';

/**
 * Approvals.
 *
 * When a policy answers REQUIRE_APPROVAL, this is where the owner answers back:
 * with a passkey, over the decision hash, so the approval is a signature anyone
 * can check -- and Monad does.
 */
export default async function ApprovalsPage() {
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  const repo = await getRepository();
  const rows = session ? await repo.listApprovals(session.address, 40) : [];
  const settled = await Promise.all(rows.map((r) => settleExpiry(repo, r)));
  const approvals = await Promise.all(settled.map((r) => describeApproval(repo, r, true)));
  const approver = session ? await repo.getApproverKey(session.address) : null;
  const contract = approvalsAddress();

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Approvals</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-muted">
            Some actions are inside the policy and still need a human. You approve with a passkey,
            over the exact decision — and Monad verifies that signature itself, with its native
            P-256 precompile.
          </p>
        </div>
        {contract ? (
          <a href={explorerAddressUrl(contract)} target="_blank" rel="noreferrer">
            <Badge tone="chain">WebAuthn · P-256 · verified on Monad</Badge>
          </a>
        ) : (
          <Badge tone="warn">on-chain verification not configured</Badge>
        )}
      </header>

      <ApprovalsPanel
        approvals={approvals}
        approver={approver ? { credentialId: approver.credentialId, x: approver.publicKeyX, createdAt: approver.createdAt } : null}
        sharedDemo={isSharedDemoOwner(session?.address)}
      />
    </div>
  );
}
