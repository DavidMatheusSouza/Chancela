import { beforeEach, describe, expect, it, vi } from 'vitest';

// Anvil deterministic account #1: a published test vector, not a secret.
process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
// No POLICY_REGISTRY_ADDRESS: anchoring is skipped, and the decision must still
// be produced and enforced. Monad must be a proof dependency, not a liveness one.
delete process.env.POLICY_REGISTRY_ADDRESS;

const { authorize } = await import('../src/lib/authorize.js');
const { execute } = await import('../src/lib/executor.js');
const { getRepository } = await import('../src/lib/store.js');

describe('authorize -> execute', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('allows a permitted action and executes it exactly once', async () => {
    const decision = await authorize({
      agentId: 'TA-001',
      action: 'CREATE_CUSTOMER',
      parameters: { name: 'Joao' },
    });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.reasonCode).toBe('OK');

    const first = await execute({
      agentId: 'TA-001',
      capsule: decision.capsule,
      signature: decision.signature,
      parameters: { name: 'Joao' },
    });
    expect(first.ok).toBe(true);

    // Replay of the same capsule must fail.
    const second = await execute({
      agentId: 'TA-001',
      capsule: decision.capsule,
      signature: decision.signature,
      parameters: { name: 'Joao' },
    });
    expect(second.ok).toBe(false);
    expect(second.code).toBe('REPLAYED');
  });

  it('denies a transfer the policy does not permit, and the executor refuses the capsule', async () => {
    const decision = await authorize({
      agentId: 'TA-001',
      action: 'TRANSFER_FUNDS',
      parameters: { amount: 500_000, currency: 'USD', recipient: 'Joao' },
    });
    expect(decision.decision).toBe('DENY');
    expect(decision.reasonCode).toBe('PERMISSION_DENIED');
    expect(decision.risk).toBe('CRITICAL');

    // A DENY capsule is signed and real -- and still buys nothing.
    const attempt = await execute({
      agentId: 'TA-001',
      capsule: decision.capsule,
      signature: decision.signature,
      parameters: { amount: 500_000, currency: 'USD', recipient: 'Joao' },
    });
    expect(attempt.ok).toBe(false);
    expect(attempt.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses execution when parameters are swapped after the decision', async () => {
    const decision = await authorize({
      agentId: 'TA-001',
      action: 'CREATE_CUSTOMER',
      parameters: { name: 'Joao' },
    });
    expect(decision.decision).toBe('ALLOW');

    const tampered = await execute({
      agentId: 'TA-001',
      capsule: decision.capsule,
      signature: decision.signature,
      parameters: { name: 'Attacker Inc' },
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.code).toBe('INTENT_MISMATCH');
  });

  it('refuses a capsule presented for a different agent', async () => {
    const decision = await authorize({
      agentId: 'TA-001',
      action: 'CREATE_CUSTOMER',
      parameters: { name: 'Joao' },
    });
    const crossed = await execute({
      agentId: 'TA-002',
      capsule: decision.capsule,
      signature: decision.signature,
      parameters: { name: 'Joao' },
    });
    expect(crossed.ok).toBe(false);
    expect(crossed.code).toBe('AGENT_MISMATCH');
  });

  it('escalates to REQUIRE_APPROVAL when the counterparty is flagged', async () => {
    const decision = await authorize({
      agentId: 'TA-003',
      action: 'TRANSFER_FUNDS',
      parameters: {
        amount: 1_000,
        currency: 'USD',
        recipient: 'Unknown',
        recipientAddress: '0x000000000000000000000000000000000000dead',
      },
    });
    expect(decision.decision).toBe('REQUIRE_APPROVAL');
    expect(decision.risk).toBe('CRITICAL');
  });

  it('records denials in the audit trail, not just allows', async () => {
    await authorize({ agentId: 'TA-002', action: 'TRANSFER_FUNDS', parameters: { amount: 1 } });
    const repo = await getRepository();
    const rows = await repo.listDecisions({ agentId: 'TA-002' });
    expect(rows.some((r) => r.outcome === 'DENY')).toBe(true);
    expect(rows[0]?.auditId).toMatch(/^TA-AUDIT-/);
  });

  it('produces a decision even though on-chain anchoring is unavailable', async () => {
    const decision = await authorize({
      agentId: 'TA-001',
      action: 'READ_CUSTOMERS',
      parameters: {},
    });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.decisionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('gives every decision a distinct nonce and hash', async () => {
    const a = await authorize({ agentId: 'TA-001', action: 'READ_CUSTOMERS', parameters: {} });
    const b = await authorize({ agentId: 'TA-001', action: 'READ_CUSTOMERS', parameters: {} });
    expect(a.decisionHash).not.toBe(b.decisionHash);
  });

  it('rejects an unknown agent', async () => {
    await expect(
      authorize({ agentId: 'TA-999', action: 'READ_CUSTOMERS', parameters: {} }),
    ).rejects.toThrow(/Unknown agent/);
  });
});
