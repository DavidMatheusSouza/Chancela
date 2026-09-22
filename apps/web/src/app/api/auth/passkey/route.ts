import { z } from 'zod';
import { cookies } from 'next/headers';
import { getAddress } from 'viem';
import { verifyChallenge } from '@/lib/siwe';
import { SESSION_COOKIE, createSession, sessionCookieOptions } from '@/lib/session';
import { getRepository } from '@/lib/store';
import { createAgentFor } from '@/lib/create-agent';
import { fail, ok, rateLimitCaller } from '@/lib/http';

export const dynamic = 'force-dynamic';

const schema = z
  .object({ nonce: z.string().min(8), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) })
  .strict();

/**
 * Sign in with a passkey -- and, for someone new, onboard them.
 *
 * The server never sees a passkey. The browser derives the owner key from it
 * (see lib/passkey-keys.ts) and signs the same challenge a wallet would, so
 * this verifies an ordinary signature through the ordinary path. What differs
 * is what happens to an address that owns nothing.
 *
 * The wallet route refuses such an address, because "signed in" is meant to
 * imply owning an agent. Here that would make onboarding impossible: a new
 * passkey has, by construction, never owned anything. So a new owner is given
 * one starter agent, and it is deliberately close to useless -- a single read
 * permission, zero limits -- because deny-by-default has to hold for a stranger
 * who arrived ten seconds ago as much as for anyone else. Widening it is a
 * policy edit the owner then makes on purpose.
 *
 * This is an unauthenticated write, which is the cost of having an onboarding
 * path at all. It is rate limited, and what it creates can do nothing.
 */
export async function POST(request: Request) {
  if (!rateLimitCaller(request, 'auth:passkey', 12, 120)) {
    return fail(429, 'RATE_LIMITED', 'Too many sign-in attempts');
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, 'INVALID_BODY', 'nonce and signature are required');

  const result = await verifyChallenge(parsed.data.nonce, parsed.data.signature);
  if (!result.ok || !result.address) {
    return fail(401, result.reason ?? 'BAD_SIGNATURE', 'Signature verification failed');
  }
  const address = getAddress(result.address);

  const repo = await getRepository();
  const agents = await repo.listAgents();
  const owns = agents.some((a) => getAddress(a.ownerAddress) === address);

  let onboarded = false;
  if (!owns) {
    await createAgentFor(repo, {
      ownerAddress: address,
      name: 'My first agent',
      description: 'Created at passkey sign-up. Read-only until its owner says otherwise.',
      permissions: ['READ_CUSTOMERS'],
    });
    onboarded = true;
  }

  const token = await createSession(address, 'passkey');
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions(request));
  return ok({ address, onboarded });
}
