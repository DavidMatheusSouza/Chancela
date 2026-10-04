/**
 * Replay, end to end through the service.
 *
 * The engine's own tests show that a bundle reproduces a hash. These show the
 * service hands out the right bundle: the one taken at the moment of the
 * decision, which still reproduces it after the usage counters have moved on,
 * and which is served to the public only for the public demo agents.
 */
import { describe, expect, it } from 'vitest';

// Anvil deterministic account #1: a published test vector, not a secret.
process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
delete process.env.POLICY_REGISTRY_ADDRESS;

const { authorize } = await import('../src/lib/authorize.js');
const { createAgentFor } = await import('../src/lib/create-agent.js');
const { getRepository } = await import('../src/lib/store.js');
const { replayDecision } = await import('../src/lib/proof.js');
const { DEMO_OWNER_ADDRESS } = await import('../src/lib/demo-signin.js');
const { GET } = await import('../src/app/api/proofs/[id]/replay/route.js');
const { hashPolicyDocument } = await import('@chancela/shared');
const { replay } = await import('@chancela/policy-engine');

const SOMEONE_ELSE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

/** $500 an order, $700 or 2 orders a day. */
async function tradingAgent(name: string, ownerAddress: string) {
  const repo = await getRepository();
  const { agent } = await createAgentFor(repo, { ownerAddress, name, permissions: ['PLACE_ORDER'] });
  const document = {
    agentId: agent.id,
    name,
    version: 2,
    permissions: ['PLACE_ORDER' as const],
    limits: { maxTransactionValue: 50_000, dailyTransactions: 2, dailyValueCap: 70_000 },
    stepUpThreshold: 'CRITICAL' as const,
    environment: {},
  };
  const policy = await repo.createPolicy({
    id: `pol_${agent.id}_v2`,
    agentId: agent.id,
    name,
    version: 2,
    policyHash: hashPolicyDocument({ ...document, limits: document.limits as unknown as Record<string, number> }),
    document,
    status: 'DRAFT',
  });
  await repo.activatePolicy(policy.id);
  return agent.id;
}

const order = (amount: number) => ({ amount, market: 'MON/USDC', side: 'BUY' });
const get = (id: string) =>
  GET(new Request(`http://localhost/api/proofs/${id}/replay`), { params: { id } }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));

describe('replay through the service', () => {
  it('hands the caller a bundle that reproduces the signed hash', async () => {
    const id = await tradingAgent('Replayed', DEMO_OWNER_ADDRESS);
    const decision = await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(10_000) });

    // As the caller would hold it: after JSON.
    const bundle = JSON.parse(JSON.stringify(decision.replay));
    const verdict = replay(bundle, {
      decisionHash: decision.decisionHash,
      policyHash: decision.policyHash,
      intentHash: decision.intentHash,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.result?.decision).toBe('ALLOW');
    expect(bundle.parameters).toEqual(order(10_000));
  });

  it('records usage as it was when the decision was taken, not as it is now', async () => {
    const id = await tradingAgent('Counted', DEMO_OWNER_ADDRESS);
    const first = await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(40_000) });
    const second = await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(40_000) });
    expect(second.reasonCode).toBe('DAILY_LIMIT_EXCEEDED');

    expect(first.replay.usage).toEqual({ transactionsToday: 0, valueMovedToday: 0 });
    expect(second.replay.usage).toEqual({ transactionsToday: 1, valueMovedToday: 40_000 });

    // Both still replay from the stored record, the refusal included.
    const repo = await getRepository();
    for (const d of [first, second]) {
      const stored = await repo.getDecision(d.decisionId);
      expect(replayDecision(stored!)?.ok).toBe(true);
    }
  });

  it('serves the bundle publicly for a demo agent', async () => {
    const id = await tradingAgent('Public', DEMO_OWNER_ADDRESS);
    const decision = await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(2_500_000) });
    expect(decision.reasonCode).toBe('LIMIT_EXCEEDED');

    // By audit id and by decision hash, the two a reader is likely to hold.
    for (const key of [decision.auditId, decision.decisionHash]) {
      const { status, body } = await get(key);
      expect(status).toBe(200);
      expect(body.decisionHash).toBe(decision.decisionHash);
      expect(body.serverReplay.ok).toBe(true);
      const verdict = replay(body.bundle, {
        decisionHash: body.decisionHash,
        policyHash: body.policyHash,
        intentHash: body.intentHash,
      });
      expect(verdict.ok).toBe(true);
      expect(verdict.result?.reasonCode).toBe('LIMIT_EXCEEDED');
    }
  });

  it('does not serve another owner\'s parameters to the public', async () => {
    const id = await tradingAgent('Private', SOMEONE_ELSE);
    const decision = await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(10_000) });
    // The caller still gets it.
    expect(decision.replay.parameters).toEqual(order(10_000));

    const { status, body } = await get(decision.auditId);
    expect(status).toBe(403);
    expect(body.error.code).toBe('INPUTS_PRIVATE');
    expect(JSON.stringify(body)).not.toContain('MON/USDC');
  });

  it('says so, rather than guessing, for a decision with no recorded inputs', async () => {
    const id = await tradingAgent('Old', DEMO_OWNER_ADDRESS);
    const decision = await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(10_000) });
    const repo = await getRepository();
    const stored = await repo.getDecision(decision.decisionId);
    delete stored!.inputs; // as a row written before the column existed

    expect(replayDecision(stored!)).toBeNull();
    const { status, body } = await get(decision.auditId);
    expect(status).toBe(404);
    expect(body.error.code).toBe('INPUTS_NOT_RECORDED');
  });

  it('answers 404 for a decision that does not exist', async () => {
    expect((await get('TA-AUDIT-00000000')).status).toBe(404);
  });
});
