import { randomUUID } from 'node:crypto';
import { lookupTool } from '@chancela/shared';
import { verifyCapsule } from './attestation';
import { getRepository } from './store';

export interface ExecuteResult {
  ok: boolean;
  code: string;
  detail?: string;
  actionId?: string;
  result?: unknown;
}

/**
 * The only way a tool ever runs.
 *
 * It accepts a signed capsule, not an intent. Whatever produced the intent --
 * a frontier model, a keyword matcher, a compromised prompt -- is irrelevant
 * here, because none of it is presented as evidence. Only the attestation
 * signature is.
 */
export async function execute(input: {
  agentId: string;
  capsule: unknown;
  signature: string;
  parameters: Record<string, unknown>;
}): Promise<ExecuteResult> {
  const repo = await getRepository();
  const now = Math.floor(Date.now() / 1000);

  const verdict = await verifyCapsule(
    { capsule: input.capsule, signature: input.signature },
    {
      now,
      parameters: input.parameters,
      isNonceUsed: (nonce) => repo.isNonceUsed(nonce),
    },
  );

  if (!verdict.ok) {
    return { ok: false, code: verdict.code, detail: verdict.detail };
  }

  const capsule = input.capsule as {
    agentId: string;
    action: string;
    nonce: string;
    decisionHash: string;
  };

  if (capsule.agentId !== input.agentId) {
    return { ok: false, code: 'AGENT_MISMATCH', detail: capsule.agentId };
  }

  /*
   * Resolve the decision this capsule came from, before burning anything.
   *
   * An action only means something as the consequence of a recorded decision,
   * so it is looked up rather than assumed. Doing it first also means a
   * capsule we cannot tie to a decision costs the caller nothing -- the nonce
   * is still spendable, and they get a reason instead of a silent no-op.
   */
  const decision = await repo.getDecisionByHash(capsule.decisionHash);
  if (!decision) {
    return { ok: false, code: 'UNKNOWN_DECISION', detail: capsule.decisionHash };
  }

  // Burn the nonce before doing any work. If two requests race, exactly one wins.
  if (!(await repo.consumeNonce(capsule.nonce, input.agentId))) {
    return { ok: false, code: 'REPLAYED', detail: capsule.nonce };
  }

  const tool = lookupTool(capsule.action);
  if (!tool) return { ok: false, code: 'UNKNOWN_ACTION', detail: capsule.action };

  const actionId = `act_${randomUUID()}`;
  let result: unknown;
  try {
    result = await runTool(tool.toolId, input.parameters);
  } catch (err) {
    await repo.recordAction({
      id: actionId,
      agentId: input.agentId,
      decisionId: decision.id,
      toolId: tool.toolId,
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'tool failed',
    });
    return { ok: false, code: 'TOOL_FAILED', detail: String(err), actionId };
  }

  // Daily usage is not recorded here: authorize() spends it when it issues the
  // ALLOW, because most integrators execute on their own side and never call this.

  await repo.recordAction({
    id: actionId,
    agentId: input.agentId,
    decisionId: decision.id,
    toolId: tool.toolId,
    status: 'EXECUTED',
    result,
    executedAt: new Date().toISOString(),
  });

  return { ok: true, code: 'EXECUTED', actionId, result };
}

/**
 * Demo tool implementations.
 *
 * These stand in for a real business system. TRANSFER_FUNDS deliberately has no
 * implementation at all: there is no code path in this repository that can move
 * value, so a bug in the policy engine cannot cost anyone money.
 */
async function runTool(toolId: string, parameters: Record<string, unknown>): Promise<unknown> {
  switch (toolId) {
    case 'CREATE_CUSTOMER':
      return { customerId: `cus_${randomUUID().slice(0, 8)}`, name: parameters.name };
    case 'READ_CUSTOMERS':
      return { customers: [{ id: 'cus_demo1', name: 'Acme Ltda' }, { id: 'cus_demo2', name: 'Joao' }] };
    case 'UPDATE_CUSTOMER':
      return { customerId: parameters.customerId, updated: true };
    case 'DELETE_CUSTOMER':
      return { customerId: parameters.customerId, deleted: true };
    case 'SEND_PROPOSAL':
      return { proposalId: `prp_${randomUUID().slice(0, 8)}`, sentTo: parameters.customerId };
    case 'SEND_MESSAGE':
      return { messageId: `msg_${randomUUID().slice(0, 8)}`, to: parameters.to };
    case 'READ_TREASURY':
      return { balanceMinorUnits: 1_250_00, currency: 'USD' };
    case 'TRANSFER_FUNDS':
    case 'PLACE_ORDER':
      throw new Error(
        'No transfer backend is wired in this build. Value movement is intentionally unimplemented.',
      );
    default:
      throw new Error(`Tool ${toolId} has no implementation`);
  }
}
