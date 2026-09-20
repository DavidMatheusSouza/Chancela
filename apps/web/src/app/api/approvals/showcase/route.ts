import { privateKeyToAccount } from 'viem/accounts';
import { describeApproval } from '@/lib/approval-view';
import { ok } from '@/lib/http';
import { getRepository } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Anvil deterministic account #1 -- the published demo owner, not a secret.
const DEMO_OWNER = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
).address;

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
  const approvals = await repo.listApprovals(DEMO_OWNER, 100);
  const latest = approvals.find((a) => a.status === 'APPROVED' && a.onchainStatus === 'CONFIRMED');
  return ok({ approval: latest ? await describeApproval(repo, latest, false) : null });
}
