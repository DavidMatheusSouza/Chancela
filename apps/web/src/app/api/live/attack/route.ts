import { ATTACKS, TRADING_AGENT_ID } from '@/lib/live-bot';
import { authorize } from '@/lib/authorize';
import { getRepository } from '@/lib/store';
import { callerKey, fail, ok, rateLimitCaller } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * A visitor attacks the live trading agent.
 *
 * The body names an attack by id and nothing else; the action and parameters
 * come from the fixed list in lib/live-bot, so this endpoint can only ever ask
 * for things the agent's policy refuses. It goes through `authorize()` like any
 * integrator's request -- which means it is anchored, counts toward the circuit
 * breaker, and spends from the same per-caller anchor budget.
 */
export async function POST(request: Request) {
  if (!rateLimitCaller(request, 'live-attack', 6, 120)) {
    return fail(429, 'RATE_LIMITED', 'Give it a minute. The agent is still recovering from the last ones.');
  }

  const body = (await request.json().catch(() => null)) as { attack?: unknown } | null;
  const attack = ATTACKS.find((a) => a.id === body?.attack);
  if (!attack) return fail(400, 'UNKNOWN_ATTACK', `Pick one of: ${ATTACKS.map((a) => a.id).join(', ')}`);

  const repo = await getRepository();
  if (!(await repo.getAgent(TRADING_AGENT_ID))) {
    return fail(503, 'NO_AGENT', 'The live trading agent is not registered on this deployment.');
  }

  const decision = await authorize({
    agentId: TRADING_AGENT_ID,
    action: attack.action,
    parameters: attack.parameters,
    caller: callerKey(request),
  });

  return ok({
    attack: attack.id,
    action: attack.action,
    decision: decision.decision,
    reasonCode: decision.reasonCode,
    reasonText: decision.reasonText,
    risk: decision.risk,
    auditId: decision.auditId,
    anchorStatus: decision.anchorStatus,
    breaker: decision.breaker,
  });
}
