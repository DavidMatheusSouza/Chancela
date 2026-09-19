import { z } from 'zod';
import { cookies } from 'next/headers';
import { getAddress } from 'viem';
import { PrivyClient } from '@privy-io/server-auth';
import { SESSION_COOKIE, createSession, sessionCookieOptions } from '@/lib/session';
import { getRepository } from '@/lib/store';
import { fail, ok, rateLimit } from '@/lib/http';

export const dynamic = 'force-dynamic';

const schema = z.object({ accessToken: z.string().min(16) }).strict();

/**
 * Exchange a Privy access token for a TrustAgent session.
 *
 * Privy answers exactly one question -- "is this person who they say they
 * are, and which wallet is theirs". It is an identity provider here and
 * nothing more. Two properties follow, and both are deliberate:
 *
 *  1. The token is verified server-side against the app secret. A client that
 *     simply claims an address gets nowhere, because the address is read out
 *     of the verified token, never out of the request body.
 *  2. A verified Privy user who owns no agent is refused, exactly as the SIWE
 *     path refuses them. Authentication is not authorization, and the provider
 *     does not get to widen who counts as an owner.
 *
 * Nothing about the policy engine changes when this route is used. The session
 * it mints is the same session the wallet path mints, differing only in the
 * `method` field, which exists so the audit trail can say how someone got in.
 */
export async function POST(request: Request) {
  if (!rateLimit('auth:privy', 30)) {
    return fail(429, 'RATE_LIMITED', 'Too many sign-in attempts');
  }

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    return fail(503, 'PRIVY_NOT_CONFIGURED', 'Privy is not configured on this deployment');
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, 'INVALID_BODY', 'accessToken is required');

  const privy = new PrivyClient(appId, appSecret);

  let userId: string;
  try {
    const claims = await privy.verifyAuthToken(parsed.data.accessToken);
    userId = claims.userId;
  } catch {
    return fail(401, 'BAD_TOKEN', 'Privy token verification failed');
  }

  // The address comes from Privy's record of the user, not from the client.
  const user = await privy.getUser(userId).catch(() => null);
  if (!user) return fail(401, 'UNKNOWN_USER', 'Privy user not found');

  const candidates = user.linkedAccounts
    .filter((a): a is typeof a & { address: string } => 'address' in a && typeof a.address === 'string')
    .map((a) => a.address)
    .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));

  if (candidates.length === 0) {
    return fail(403, 'NO_WALLET', 'This Privy account has no Ethereum wallet linked');
  }

  const repo = await getRepository();
  const agents = await repo.listAgents();
  const owned = candidates.find((candidate) =>
    agents.some((a) => getAddress(a.ownerAddress) === getAddress(candidate)),
  );

  if (!owned) {
    return fail(
      403,
      'NOT_AN_OWNER',
      'No wallet on this Privy account owns an agent in this deployment.',
    );
  }

  const address = getAddress(owned);
  const token = await createSession(address, 'privy');
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions(request));
  return ok({ address, method: 'privy' });
}
