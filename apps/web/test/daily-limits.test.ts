import { describe, expect, it } from 'vitest';

// Anvil deterministic account #1: a published test vector, not a secret.
process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
delete process.env.POLICY_REGISTRY_ADDRESS;

const { authorize } = await import('../src/lib/authorize.js');
const { createAgentFor } = await import('../src/lib/create-agent.js');
const { getRepository } = await import('../src/lib/store.js');
const { hashPolicyDocument } = await import('@chancela/shared');

const OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

/** A trading agent whose owner set real limits: $500 an order, $700 or 2 orders a day. */
async function tradingAgent(name: string) {
  const repo = await getRepository();
  const { agent } = await createAgentFor(repo, { ownerAddress: OWNER, name, permissions: ['PLACE_ORDER'] });
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
    policyHash: hashPolicyDocument({
      ...document,
      limits: document.limits as unknown as Record<string, number>,
    }),
    document,
    status: 'DRAFT',
  });
  await repo.activatePolicy(policy.id);
  return agent.id;
}

const order = (amount: number) => ({ amount, market: 'MON/USDC', side: 'BUY' });

// The integrator's path: authorize, then execute on their own side. Nothing in
// this file calls execute() -- the limits have to hold without it.
describe('daily limits for an agent that executes on its own side', () => {
  it('counts each allowed order, so the day runs out', async () => {
    const id = await tradingAgent('Counted');
    expect((await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(10_000) })).decision).toBe('ALLOW');
    expect((await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(10_000) })).decision).toBe('ALLOW');

    const third = await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(10_000) });
    expect(third.decision).toBe('DENY');
    expect(third.reasonCode).toBe('DAILY_LIMIT_EXCEEDED');
  });

  it('counts the value, so the cap runs out before the count does', async () => {
    const id = await tradingAgent('Valued');
    expect((await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(35_000) })).decision).toBe('ALLOW');

    const second = await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(36_000) });
    expect(second.decision).toBe('DENY');
    expect(second.reasonCode).toBe('DAILY_LIMIT_EXCEEDED');
  });

  it('spends nothing on a refusal or a step-up', async () => {
    const id = await tradingAgent('Refused');
    expect((await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(60_000) })).reasonCode).toBe(
      'LIMIT_EXCEEDED',
    );
    expect((await authorize({ agentId: id, action: 'PLACE_ORDER', parameters: order(45_000) })).decision).toBe(
      'REQUIRE_APPROVAL',
    );

    const repo = await getRepository();
    expect(await repo.usageFor(id, new Date().toISOString().slice(0, 10))).toEqual({
      transactionsToday: 0,
      valueMovedToday: 0,
    });
  });
});
