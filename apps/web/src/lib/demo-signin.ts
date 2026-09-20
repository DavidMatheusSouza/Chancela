import { privateKeyToAccount } from 'viem/accounts';
import { getAddress, type Hex } from 'viem';
import { buildMessage, issueChallenge, verifyChallenge } from './siwe';
import { createSession } from './session';
import { getRepository } from './store';

/**
 * Sign in as the seeded demo owner.
 *
 * Signs the same challenge with the seeded owner's published test key and puts
 * it through the identical verification path -- no branch skips the signature
 * check, the nonce burn or the ownership check. It exists so a judge can open
 * the demo without installing a wallet.
 *
 * Refused in production unless ALLOW_DEV_SIGNIN is explicitly set, so the
 * convenience cannot escape the demo by accident.
 */

// Anvil deterministic account #1 — a published test vector, not a secret.
const DEMO_OWNER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;

export function demoSignInAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_SIGNIN === 'true';
}

export type DemoSignIn =
  | { ok: true; address: string; token: string }
  | { ok: false; status: number; code: string; message: string };

export async function demoSignIn(): Promise<DemoSignIn> {
  if (!demoSignInAllowed()) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Not available' };

  const repo = await getRepository();
  const account = privateKeyToAccount(DEMO_OWNER_KEY);
  const demoAddress = getAddress(account.address);
  // Any agent of the demo owner will do. Looking only at the first agent broke
  // the moment somebody else signed up before the seed had run.
  const owned = (await repo.listAgents()).some((a) => getAddress(a.ownerAddress) === demoAddress);
  if (!owned) {
    return {
      ok: false,
      status: 503,
      code: 'DEMO_KEY_MISMATCH',
      message: `No agent is owned by the demo key ${demoAddress}. Seed the demo agents, or set DEMO_OWNER_ADDRESS to match.`,
    };
  }

  const { nonce } = issueChallenge(account.address);
  const signature = await account.signMessage({ message: buildMessage(demoAddress, nonce) });
  const result = await verifyChallenge(nonce, signature);
  if (!result.ok || !result.address) {
    return { ok: false, status: 500, code: 'DEMO_SIGNIN_FAILED', message: result.reason ?? 'verification failed' };
  }
  return { ok: true, address: result.address, token: await createSession(result.address, 'wallet') };
}

/** Where to send someone after signing them in: a path on this site, or /demo. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/demo';
  return raw;
}
