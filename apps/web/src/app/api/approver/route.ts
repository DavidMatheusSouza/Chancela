import { cookies } from 'next/headers';
import { z } from 'zod';
import { ApprovalError, registerApprover } from '@/lib/approvals';
import { fail, ok, rateLimitCaller } from '@/lib/http';
import { SESSION_COOKIE, readSession } from '@/lib/session';
import { getRepository } from '@/lib/store';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    credentialId: z.string().min(8).max(1024),
    publicKeySpki: z.string().min(40).max(2048),
    enrolmentCode: z.string().max(200).optional(),
  })
  .strict();

/** The signed-in owner's approver passkey: whether one is enrolled, and its public key. */
export async function GET() {
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'Sign in to use this endpoint');
  const key = await (await getRepository()).getApproverKey(session.address);
  return ok({
    approver: key ? { credentialId: key.credentialId, x: key.publicKeyX, y: key.publicKeyY, createdAt: key.createdAt } : null,
  });
}

/** Enrol the passkey this owner approves step-up decisions with. */
export async function POST(request: Request) {
  if (!rateLimitCaller(request, 'approver:enrol', 20, 200)) return fail(429, 'RATE_LIMITED', 'Too many attempts');
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return fail(401, 'UNAUTHENTICATED', 'Sign in to use this endpoint');

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, 'INVALID_BODY', 'credentialId and publicKeySpki are required');

  try {
    const key = await registerApprover(await getRepository(), session.address, parsed.data);
    return ok({ approver: { credentialId: key.credentialId, x: key.publicKeyX, y: key.publicKeyY, createdAt: key.createdAt } });
  } catch (err) {
    if (err instanceof ApprovalError) return fail(err.status, err.code, err.message);
    return fail(500, 'INTERNAL', 'Could not enrol the approver');
  }
}
