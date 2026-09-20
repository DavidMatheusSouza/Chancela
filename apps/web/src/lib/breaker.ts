import type { DecisionRow, Repository } from './repository';

/**
 * Circuit breaker.
 *
 * One refused transfer is a policy doing its job. Three in ninety seconds is an
 * agent that is compromised, confused or being driven by someone hostile, and
 * the right response to that is not to keep politely refusing -- it is to stop
 * listening. When the breaker trips the agent is suspended, after which the
 * very first gate of the pipeline refuses everything it asks for, including
 * actions its policy grants. Only the owner can bring it back.
 *
 * Properties that matter:
 *
 *  - It is arithmetic over the audit trail. No model is consulted, so nothing
 *    can be talked out of tripping it, and the same history always produces the
 *    same outcome.
 *  - It fails closed. The cost of a false positive is an owner clicking
 *    Reactivate; the cost of a false negative is an attacker getting unlimited
 *    attempts at finding the one phrasing that works.
 *  - Denials issued *because* the agent is suspended do not count, or the
 *    breaker would hold itself open forever.
 *
 * The trade-off is real and is recorded in THREAT_MODEL.md: whoever can submit
 * requests in an agent's name can suspend it. That is a denial of service, and
 * it is the deliberate choice -- an agent that can be made to look hostile
 * should be off until a human has looked.
 */

export const BREAKER_THRESHOLD = 3;
export const BREAKER_WINDOW_SECONDS = 90;

export interface BreakerState {
  tripped: boolean;
  /** Critical refusals inside the window, including the one just recorded. */
  count: number;
  threshold: number;
  windowSeconds: number;
}

/**
 * When each agent was last reactivated by its owner.
 *
 * A reactivation is a human saying "I have looked, carry on", so refusals from
 * before it must not count against the agent again -- otherwise the first
 * critical denial after a reset would trip the breaker straight back.
 *
 * Held in process rather than in the store. That is a real limit: a restart
 * forgets it. It is tolerable because the window is ninety seconds, so by the
 * time a process is back up there is almost nothing left to forget.
 */
const resets = (globalThis as unknown as { __trustagentBreakerResets?: Map<string, number> })
  .__trustagentBreakerResets ??= new Map<string, number>();

export function noteReactivation(agentId: string, at: Date = new Date()): void {
  resets.set(agentId, at.getTime());
}

/** A refusal that says something about the agent, rather than about its status. */
function isHostileSignal(d: DecisionRow): boolean {
  return (
    d.outcome === 'DENY' &&
    d.risk === 'CRITICAL' &&
    d.reasonCode !== 'AGENT_SUSPENDED' &&
    d.reasonCode !== 'AGENT_REVOKED'
  );
}

/**
 * Called after a decision has been recorded. Returns the breaker's view, and
 * suspends the agent if this decision was the one that crossed the line.
 */
export async function evaluateBreaker(
  repo: Repository,
  agentId: string,
  latest: DecisionRow,
  now: Date = new Date(),
): Promise<BreakerState> {
  const state: BreakerState = {
    tripped: false,
    count: 0,
    threshold: BREAKER_THRESHOLD,
    windowSeconds: BREAKER_WINDOW_SECONDS,
  };

  if (!isHostileSignal(latest)) return state;

  const windowStart = now.getTime() - BREAKER_WINDOW_SECONDS * 1000;
  const from = new Date(Math.max(windowStart, resets.get(agentId) ?? 0)).toISOString();
  const recent = await repo.listDecisions({ agentId, from, limit: 50 });
  state.count = recent.filter(isHostileSignal).length;

  if (state.count >= BREAKER_THRESHOLD) {
    const agent = await repo.getAgent(agentId);
    if (agent && agent.status === 'ACTIVE') {
      await repo.updateAgent(agentId, { status: 'SUSPENDED' });
      state.tripped = true;
    }
  }

  return state;
}
