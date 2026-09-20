import { randomBytes } from 'node:crypto';
import { getAddress, recoverMessageAddress, isAddressEqual, type Hex } from 'viem';

/**
 * Sign-in with an Ethereum wallet.
 *
 * A minimal, self-contained challenge/response rather than a SIWE library: the
 * message is fully specified below, so a reviewer can read exactly what is
 * signed instead of trusting a dependency to build it.
 */

interface Challenge {
  nonce: string;
  address: string;
  expiresAt: number;
}

// Single-process store. A multi-instance deployment needs Redis here; noted in
// DEPLOYMENT.md rather than silently pretending this scales.
const challenges = new Map<string, Challenge>();
const CHALLENGE_TTL_MS = 5 * 60_000;

export function issueChallenge(address: string): { nonce: string; message: string } {
  const checksummed = getAddress(address);
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;

  challenges.set(nonce, { nonce, address: checksummed, expiresAt });
  pruneExpired();

  return { nonce, message: buildMessage(checksummed, nonce) };
}

export function buildMessage(address: string, nonce: string): string {
  return [
    'Chancela wants you to sign in with your Ethereum account:',
    address,
    '',
    'Signing proves you control this address. Chancela only grants',
    'administration of agents whose ERC-8004 identity this address owns.',
    '',
    'This signature costs no gas and authorises no transaction.',
    '',
    `Nonce: ${nonce}`,
  ].join('\n');
}

export interface VerifyChallengeResult {
  ok: boolean;
  address?: string;
  reason?: 'UNKNOWN_NONCE' | 'EXPIRED' | 'BAD_SIGNATURE' | 'ADDRESS_MISMATCH';
}

export async function verifyChallenge(
  nonce: string,
  signature: string,
): Promise<VerifyChallengeResult> {
  const challenge = challenges.get(nonce);
  if (!challenge) return { ok: false, reason: 'UNKNOWN_NONCE' };

  // Burn it immediately: a challenge is single-use whether or not it verifies,
  // so a failed attempt cannot be retried against the same nonce.
  challenges.delete(nonce);

  if (challenge.expiresAt <= Date.now()) return { ok: false, reason: 'EXPIRED' };

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: buildMessage(challenge.address, nonce),
      signature: signature as Hex,
    });
  } catch {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  if (!isAddressEqual(recovered as Hex, challenge.address as Hex)) {
    return { ok: false, reason: 'ADDRESS_MISMATCH' };
  }

  return { ok: true, address: challenge.address };
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [nonce, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(nonce);
  }
}

/** Test seam. */
export function clearChallenges(): void {
  challenges.clear();
}
