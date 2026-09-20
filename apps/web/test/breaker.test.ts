import { describe, expect, it } from 'vitest';

// Anvil deterministic account #1: a published test vector, not a secret.
process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
delete process.env.POLICY_REGISTRY_ADDRESS;

const { authorize } = await import('../src/lib/authorize.js');
const { getRepository } = await import('../src/lib/store.js');
const { BREAKER_THRESHOLD, noteReactivation } = await import('../src/lib/breaker.js');

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
