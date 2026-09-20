import { cookies } from 'next/headers';
import { describeApproval } from '@/lib/approval-view';
import { settleExpiry } from '@/lib/approvals';
import { fail, ok } from '@/lib/http';
import { SESSION_COOKIE, readSession } from '@/lib/session';
import { getRepository } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Approval requests for the agents the signed-in owner holds, newest first. */
export async function GET() {
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'Sign in to use this endpoint');
  const repo = await getRepository();
  const rows = await repo.listApprovals(session.address, 50);
  const settled = await Promise.all(rows.map((r) => settleExpiry(repo, r)));
  return ok({ approvals: await Promise.all(settled.map((r) => describeApproval(repo, r, true))) });
}
