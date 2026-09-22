import { cookies } from 'next/headers';
import { z } from 'zod';
import { describeApproval } from '@/lib/approval-view';
import { ApprovalError, approve, settleExpiry } from '@/lib/approvals';
import { AuthorizeError } from '@/lib/authorize';
import { fail, ok, rateLimitCaller } from '@/lib/http';
import { SESSION_COOKIE, readSession } from '@/lib/session';
import { getRepository } from '@/lib/store';

export const dynamic = 'force-dynamic';

const assertionSchema = z
  .object({
    credentialId: z.string().min(8).max(1024),
    authenticatorData: z.string().min(40).max(4096),
    clientDataJSON: z.string().min(40).max(8192),
    signature: z.string().min(40).max(1024),
  })
  .strict();

/**
 * GET /api/approvals/:id -- where an agent's runtime waits for the answer.
 *
 * Public, because the runtime has no session. The id is a capability handed
 * only to whoever asked for the authorization, and what it unlocks is the
 * status and -- once approved -- the ALLOW capsule that request was waiting
 * for. It shows hashes, never the parameters.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const repo = await getRepository();
  const found = await repo.getApproval(params.id);
  if (!found) return fail(404, 'NOT_FOUND', 'Unknown approval request');
  return ok({ approval: await describeApproval(repo, await settleExpiry(repo, found), false) });
}

/** POST /api/approvals/:id -- the owner's passkey assertion over the decision hash. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!rateLimitCaller(request, `approve:${params.id}`, 10, 30)) return fail(429, 'RATE_LIMITED', 'Too many attempts');
  // The path is public for GET, so the session is checked here, not in middleware.
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'Sign in as the agent owner to approve');

  const parsed = assertionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, 'INVALID_BODY', 'A WebAuthn assertion is required');

  const repo = await getRepository();
  try {
    const { approval } = await approve(repo, params.id, session.address, parsed.data);
    return ok({ approval: await describeApproval(repo, approval, true) });
  } catch (err) {
    if (err instanceof ApprovalError) return fail(err.status, err.code, err.message);
    if (err instanceof AuthorizeError) return fail(err.status, 'AUTHORIZE_FAILED', err.message);
    return fail(500, 'INTERNAL', 'Approval failed');
  }
}
