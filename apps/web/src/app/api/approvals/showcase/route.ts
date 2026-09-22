import { describeApproval } from '@/lib/approval-view';
import { DEMO_OWNER_ADDRESS } from '@/lib/demo-signin';
import { ok } from '@/lib/http';
import { getRepository } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/approvals/showcase
 *
 * A visitor to the demo cannot approve anything: they do not hold the owner's
 * passkey, which is the point. So the demo shows the most recent approval the
 * owner really gave for a demo agent and that Monad really verified. Hashes and
 * the transaction only -- the same public view an agent's runtime polls.
 */
export async function GET() {
  const repo = await getRepository();
  const approvals = await repo.listApprovals(DEMO_OWNER_ADDRESS, 100);
  const latest = approvals.find((a) => a.status === 'APPROVED' && a.onchainStatus === 'CONFIRMED');
  return ok({ approval: latest ? await describeApproval(repo, latest, false) : null });
}
