import { cookies } from 'next/headers';
import { getAddress } from 'viem';
import { SESSION_COOKIE, readSession, type SessionPayload } from './session';
import { getRepository } from './store';
import { fail } from './http';
import type { AgentRow } from './repository';

/**
 * Ownership, as distinct from being signed in.
 *
 * The middleware answers "is there a session". That is not the question for
 * anything that changes what an agent may do: publishing a policy or
 * reactivating a suspended agent belongs to that agent's owner and to nobody
 * else. Without this check any signed-in owner could rewrite the policy of an
 * agent they do not own -- in a product whose entire claim is authorization.
 *
 * The comparison is on checksummed addresses, so a casing difference between
 * the session and the stored owner can neither grant nor deny by accident.
 */
export function ownsAgent(session: Pick<SessionPayload, 'address'> | null, agent: Pick<AgentRow, 'ownerAddress'>): boolean {
  if (!session) return false;
  try {
    return getAddress(session.address) === getAddress(agent.ownerAddress);
  } catch {
    return false; // a malformed address owns nothing
  }
}

type Guard =
  | { ok: true; agent: AgentRow; session: SessionPayload }
  | { ok: false; response: Response };

/** Resolve the agent and require that the caller owns it. */
export async function requireOwner(agentId: string): Promise<Guard> {
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) {
    return { ok: false, response: fail(401, 'UNAUTHENTICATED', 'Sign in to use this endpoint') };
  }

  const repo = await getRepository();
  const agent = await repo.getAgent(agentId);
  if (!agent) return { ok: false, response: fail(404, 'NOT_FOUND', `Unknown agent ${agentId}`) };

  if (!ownsAgent(session, agent)) {
    return {
      ok: false,
      response: fail(403, 'NOT_THE_OWNER', 'Only the owner of this agent may change it.'),
    };
  }
  return { ok: true, agent, session };
}
