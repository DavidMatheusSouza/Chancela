import { cookies } from 'next/headers';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress, type Hex } from 'viem';
import { buildMessage, issueChallenge, verifyChallenge } from '@/lib/siwe';
import { SESSION_COOKIE, createSession, sessionCookieOptions } from '@/lib/session';
import { getRepository } from '@/lib/store';
import { fail, ok, rateLimit } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Demo sign-in as the seeded owner.
 *
 * Signs the same challenge with the seeded owner's published test key and puts
 * it through the identical verification path — no branch skips the signature
 * check, the nonce burn or the ownership check. It exists so a judge can open
 * the demo without installing a wallet.
 *
 * Refused in production unless ALLOW_DEV_SIGNIN is explicitly set, so the
 * convenience cannot escape the demo by accident.
 */

// Anvil deterministic account #1 — a published test vector, not a secret.
const DEMO_OWNER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SIGNIN !== 'true') {
    return fail(404, 'NOT_FOUND', 'Not available');
  }
  if (!rateLimit('auth:dev', 20)) return fail(429, 'RATE_LIMITED', 'Too many attempts');

  const repo = await getRepository();
  const agents = await repo.listAgents();
  const owner = agents[0]?.ownerAddress;
  if (!owner) return fail(503, 'NO_AGENTS', 'No seeded agents to sign in as');

  const account = privateKeyToAccount(DEMO_OWNER_KEY);
  if (getAddress(account.address) !== getAddress(owner)) {
    return fail(
      503,
      'DEMO_KEY_MISMATCH',
      `Seeded owner is ${owner}, demo key controls ${account.address}. Set DEMO_OWNER_ADDRESS to match.`,
    );
  }

  const { nonce } = issueChallenge(account.address);
  const signature = await account.signMessage({
    message: buildMessage(getAddress(account.address), nonce),
  });

  const result = await verifyChallenge(nonce, signature);
  if (!result.ok || !result.address) {
    return fail(500, 'DEMO_SIGNIN_FAILED', result.reason ?? 'verification failed');
  }

  cookies().set(SESSION_COOKIE, await createSession(result.address, 'wallet'), sessionCookieOptions(request));
  return ok({ address: result.address });
}
