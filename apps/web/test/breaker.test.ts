import { describe, expect, it } from 'vitest';

// Anvil deterministic account #1: a published test vector, not a secret.
process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
delete process.env.POLICY_REGISTRY_ADDRESS;

const { authorize } = await import('../src/lib/authorize.js');
const { getRepository } = await import('../src/lib/store.js');
const { BREAKER_THRESHOLD, DEMO_COOLDOWN_SECONDS, liftDemoSuspension, noteReactivation } = await import(
  '../src/lib/breaker.js'
);

// TA-002 so these do not interfere with suites that lean on TA-001.
const AGENT = 'TA-002';
const hostile = () =>
  authorize({ agentId: AGENT, action: 'TRANSFER_FUNDS', parameters: { amount: 1, recipient: 'x' } });

/**
 * One file, run in order: the breaker is a property of history, so the tests
 * build a history rather than pretending each case starts clean.
 */
describe('circuit breaker', () => {
  it('stays closed below the threshold', async () => {
    for (let i = 1; i < BREAKER_THRESHOLD; i++) {
      const d = await hostile();
      expect(d.decision).toBe('DENY');
      expect(d.breaker.tripped).toBe(false);
      expect(d.breaker.count).toBe(i);
    }
    const repo = await getRepository();
    expect((await repo.getAgent(AGENT))!.status).toBe('ACTIVE');
  });

  it('trips on the refusal that crosses it, and suspends the agent', async () => {
    const d = await hostile();
    expect(d.breaker.tripped).toBe(true);
    expect(d.breaker.count).toBe(BREAKER_THRESHOLD);

    const repo = await getRepository();
    expect((await repo.getAgent(AGENT))!.status).toBe('SUSPENDED');
  });

  it('then refuses everything at the first gate, including what the policy grants', async () => {
    const repo = await getRepository();
    const granted = (await repo.getActivePolicy(AGENT))!.document.permissions[0]!;

    const d = await authorize({ agentId: AGENT, action: granted, parameters: {} });
    expect(d.decision).toBe('DENY');
    expect(d.reasonCode).toBe('AGENT_SUSPENDED');

    const trace = d.trace as Array<{ step: number; name: string; passed: boolean }>;
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ step: 1, name: 'agent-status', passed: false });
  });

  it('does not count its own suspensions, or it would never reopen', async () => {
    const d = await hostile();
    expect(d.reasonCode).toBe('AGENT_SUSPENDED');
    expect(d.breaker.tripped).toBe(false);
    expect(d.breaker.count).toBe(0);
  });

  it('ignores ordinary refusals — a low-risk denial is not an attack', async () => {
    const repo = await getRepository();
    await repo.updateAgent('TA-003', { status: 'ACTIVE' });
    for (let i = 0; i < BREAKER_THRESHOLD + 2; i++) {
      const d = await authorize({ agentId: 'TA-003', action: 'NOT_A_REAL_ACTION', parameters: {} });
      expect(d.decision).toBe('DENY');
      expect(d.breaker.tripped).toBe(false);
    }
    expect((await repo.getAgent('TA-003'))!.status).toBe('ACTIVE');
  });

  it('comes back only when the owner says so', async () => {
    const repo = await getRepository();
    await repo.updateAgent(AGENT, { status: 'ACTIVE' });
    noteReactivation(AGENT);

    const granted = (await repo.getActivePolicy(AGENT))!.document.permissions[0]!;
    const d = await authorize({ agentId: AGENT, action: granted, parameters: {} });
    expect(d.reasonCode).not.toBe('AGENT_SUSPENDED');
  });

  it('starts counting from zero after a reactivation', async () => {
    // Three refusals sit in the window from before. Without the reset this
    // single attempt would re-trip the breaker the owner just cleared.
    const d = await hostile();
    expect(d.breaker.count).toBe(1);
    expect(d.breaker.tripped).toBe(false);
  });
});

describe('shared demo agents reopen by themselves once it is quiet', () => {
  const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

  it('stays suspended while the hostile attempts are recent', async () => {
    // One refusal is already in the window from the suite above; two more trip it.
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) await hostile();
    const repo = await getRepository();
    const agent = (await repo.getAgent(AGENT))!;
    expect(agent.status).toBe('SUSPENDED');

    const lifted = await liftDemoSuspension(repo, agent, later(DEMO_COOLDOWN_SECONDS / 2));
    expect(lifted.status).toBe('SUSPENDED');
  });

  it('reopens after the cooldown, and the old refusals stop counting', async () => {
    const repo = await getRepository();
    const at = later(DEMO_COOLDOWN_SECONDS + 5);
    const lifted = await liftDemoSuspension(repo, (await repo.getAgent(AGENT))!, at);
    expect(lifted.status).toBe('ACTIVE');
    expect((await repo.getAgent(AGENT))!.status).toBe('ACTIVE');
  });

  it('never touches an agent that belongs to anyone else', async () => {
    const repo = await getRepository();
    const other = await repo.createAgent({
      id: 'TA-OTHER-OWNER',
      name: 'Other',
      ownerAddress: '0x000000000000000000000000000000000000dEaD',
      status: 'SUSPENDED',
      derivationIndex: 0,
    });
    const lifted = await liftDemoSuspension(repo, other, later(24 * 3600));
    expect(lifted.status).toBe('SUSPENDED');
  });

  it('gives a suspension made by hand the same cooldown', async () => {
    const repo = await getRepository();
    await repo.updateAgent('TA-003', { status: 'SUSPENDED' });
    const d = await authorize({ agentId: 'TA-003', action: 'NOT_A_REAL_ACTION', parameters: {} });
    expect(d.reasonCode).toBe('AGENT_SUSPENDED');
    expect((await repo.getAgent('TA-003'))!.status).toBe('SUSPENDED');
  });

  it('is applied on the authorization path itself, once the cooldown has passed', async () => {
    const repo = await getRepository();
    const longAgo = new Date(Date.now() - (DEMO_COOLDOWN_SECONDS + 60) * 1000).toISOString();
    await repo.updateAgent('TA-003', { suspendedAt: longAgo });
    const d = await authorize({ agentId: 'TA-003', action: 'NOT_A_REAL_ACTION', parameters: {} });
    expect(d.reasonCode).not.toBe('AGENT_SUSPENDED');
    expect((await repo.getAgent('TA-003'))!.status).toBe('ACTIVE');
  });
});
