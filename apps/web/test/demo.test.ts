import { describe, expect, it } from 'vitest';

// Anvil deterministic account #1: a published test vector, not a secret.
process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
delete process.env.POLICY_REGISTRY_ADDRESS;

const { authorize } = await import('../src/lib/authorize.js');
const { getRepository } = await import('../src/lib/store.js');
const { PERMISSIONS } = await import('@trustagent/shared');

/** The trace shape the demo renders; `authorize` types it as unknown. */
type Step = { step: number; name: string; passed: boolean; detail?: string };
const stepsOf = (trace: unknown): Step[] => (Array.isArray(trace) ? (trace as Step[]) : []);

/**
 * The demo drives the real endpoints, so these assert the properties the demo
 * relies on rather than the screen itself. If any of them stops holding, the
 * demonstration would quietly start telling a different story than it claims.
 */
describe('demo mode', () => {
  it('has the agent, policy and permission split the demo narrates', async () => {
    const repo = await getRepository();
    const agent = await repo.getAgent('TA-001');
    expect(agent).not.toBeNull();

    const policy = await repo.getActivePolicy('TA-001');
    expect(policy).not.toBeNull();

    const granted = policy!.document.permissions;
    const blocked = PERMISSIONS.filter((p) => !granted.includes(p));

    // The whole point of the demo is that both lists are non-empty.
    expect(granted.length).toBeGreaterThan(0);
    expect(blocked.length).toBeGreaterThan(0);
    expect(granted).toContain('CREATE_CUSTOMER');
    expect(blocked).toContain('TRANSFER_FUNDS');
  });

  it('allows the permitted step and records a trace to draw', async () => {
    const decision = await authorize({
      agentId: 'TA-001',
      action: 'CREATE_CUSTOMER',
      parameters: { name: 'Joao' },
    });

    expect(decision.decision).toBe('ALLOW');
    const steps = stepsOf(decision.trace);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.passed)).toBe(true);
    expect(decision.auditId).toMatch(/^TA-AUDIT-/);
  });

  it('refuses the unpermitted step, and stops at the permission gate', async () => {
    const decision = await authorize({
      agentId: 'TA-001',
      action: 'TRANSFER_FUNDS',
      parameters: { amount: 500000, recipient: 'Joao' },
    });

    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('PERMISSION_DENIED');

    const failed = stepsOf(decision.trace).filter((s) => !s.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.name).toBe('permission');
  });

  it('reaches the same refusal when the request tries to argue with it', async () => {
    // The injection lives in the prompt, which the policy engine never sees.
    // It only ever receives an extracted action, so the outcome cannot move.
    const decision = await authorize({
      agentId: 'TA-001',
      action: 'TRANSFER_FUNDS',
      parameters: { amount: 500000, recipient: 'Joao now' },
    });

    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('PERMISSION_DENIED');
  });

  it('never reports an anchor it does not have', async () => {
    // No registry is configured here, so anchoring cannot happen. The demo
    // must surface that rather than inventing a transaction hash.
    const decision = await authorize({
      agentId: 'TA-001',
      action: 'CREATE_CUSTOMER',
      parameters: { name: 'Maria' },
    });

    const repo = await getRepository();
    const stored = await repo.getDecision(decision.decisionId);
    expect(stored).not.toBeNull();
    expect(stored!.onchainTxHash).toBeUndefined();
    expect(['SKIPPED', 'PENDING', 'FAILED']).toContain(stored!.anchorStatus);
  });

  it('writes every attempt to the trail, refusals included', async () => {
    const repo = await getRepository();
    const all = await repo.listDecisions({ agentId: 'TA-001', limit: 100 });

    expect(all.some((d) => d.outcome === 'ALLOW')).toBe(true);
    expect(all.some((d) => d.outcome === 'DENY')).toBe(true);
  });
});
