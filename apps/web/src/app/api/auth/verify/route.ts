import { z } from 'zod';
import { cookies } from 'next/headers';
import { getAddress } from 'viem';
import { verifyChallenge } from '@/lib/siwe';
import { SESSION_COOKIE, createSession, sessionCookieOptions } from '@/lib/session';
import { getRepository } from '@/lib/store';
import { fail, ok, rateLimit } from '@/lib/http';

export const dynamic = 'force-dynamic';

const schema = z
  .object({ nonce: z.string().min(8), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) })
  .strict();

/**
 * Exchange a signed challenge for a session.
 *
 * Signature verification alone is not enough to grant access: anyone can sign
 * with any wallet. Access also requires owning at least one agent, which is
 * what makes "signed in" mean something here.
 */
export async function POST(request: Request) {
  if (!rateLimit('auth:verify', 30)) {
    return fail(429, 'RATE_LIMITED', 'Too many sign-in attempts');
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, 'INVALID_BODY', 'nonce and signature are required');

  const result = await verifyChallenge(parsed.data.nonce, parsed.data.signature);
  if (!result.ok || !result.address) {
    return fail(401, result.reason ?? 'BAD_SIGNATURE', 'Signature verification failed');
  }

  const repo = await getRepository();
  const agents = await repo.listAgents();
  const owns = agents.some(
    (a) => getAddress(a.ownerAddress) === getAddress(result.address as string),
  );
  if (!owns) {
    return fail(
      403,
      'NOT_AN_OWNER',
      'This address does not own any agent in this deployment.',
    );
  }

  const token = await createSession(result.address, 'wallet');
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions(request));
  return ok({ address: result.address });
}
