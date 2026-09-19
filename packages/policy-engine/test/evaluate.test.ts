import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index';
import { NOW, agent, input, salesPolicy, treasuryPolicy } from './fixtures';

describe('allow path', () => {
  it('authorizes a granted, low-risk action', () => {
    const r = evaluate(input());
    expect(r.decision).toBe('ALLOW');
    expect(r.reasonCode).toBe('OK');
    expect(r.risk).toBe('LOW');
    expect(r.capsule.policyVersion).toBe(3);
    expect(r.capsule.expiresAt).toBe(NOW + 60);
  });

  it('runs every pipeline step before allowing', () => {
    const r = evaluate(input());
    expect(r.trace.map((t) => t.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.trace.every((t) => t.passed)).toBe(true);
  });

  it('carries the policy hash and version onto the decision', () => {
    const r = evaluate(input());
    expect(r.policyHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.capsule.policyHash).toBe(r.policyHash);
    expect(r.capsule.policyVersion).toBe(salesPolicy.version);
  });
});

describe('deny matrix', () => {
  const cases: Array<[string, Parameters<typeof input>[0], string]> = [
    [
      'suspended agent',
      { agent: { ...agent, status: 'SUSPENDED' } },
      'AGENT_SUSPENDED',
    ],
    ['revoked agent', { agent: { ...agent, status: 'REVOKED' } }, 'AGENT_REVOKED'],
    ['no policy bound', { policy: null }, 'POLICY_INACTIVE'],
    [
      'expired policy',
      { policy: { ...salesPolicy, expiresAt: NOW - 1 } },
      'POLICY_EXPIRED',
    ],
    ['unknown action', { action: 'LAUNCH_MISSILES' }, 'UNKNOWN_ACTION'],
    [
      'permission not granted',
      { action: 'TRANSFER_FUNDS', parameters: { amount: 100, recipient: 'Joao' } },
      'PERMISSION_DENIED',
    ],
    [
      'parameters fail schema',
      { action: 'CREATE_CUSTOMER', parameters: { name: '' } },
      'INVALID_PARAMETERS',
    ],
    [
      'unknown parameter key is rejected',
      { action: 'CREATE_CUSTOMER', parameters: { name: 'Joao', isAdmin: true } },
      'INVALID_PARAMETERS',
    ],
    [
      'amount over per-transaction limit',
      {
        policy: treasuryPolicy,
        action: 'TRANSFER_FUNDS',
        parameters: { amount: 500_000, currency: 'USD', recipient: 'Joao' },
      },
      'LIMIT_EXCEEDED',
    ],
    [
      'daily transaction count exhausted',
      {
        policy: treasuryPolicy,
        action: 'TRANSFER_FUNDS',
        parameters: { amount: 1_000, currency: 'USD', recipient: 'Joao' },
        usage: { transactionsToday: 3, valueMovedToday: 0 },
      },
      'DAILY_LIMIT_EXCEEDED',
    ],
    [
      'daily value cap exceeded',
      {
        policy: treasuryPolicy,
        action: 'TRANSFER_FUNDS',
        parameters: { amount: 100_000, currency: 'USD', recipient: 'Joao' },
        usage: { transactionsToday: 1, valueMovedToday: 150_000 },
      },
      'DAILY_LIMIT_EXCEEDED',
    ],
    [
      'environment not allowed',
      {
        policy: { ...salesPolicy, environment: { allowedEnvironments: ['staging'] } },
        environment: 'production',
      },
      'ENVIRONMENT_NOT_ALLOWED',
    ],
    [
      'outside time window',
      {
        policy: {
          ...salesPolicy,
          environment: { timeWindowUtc: { startHour: 12, endHour: 18 } },
        },
      },
      'OUT_OF_TIME_WINDOW',
    ],
    [
      'blocked counterparty',
      {
        policy: {
          ...treasuryPolicy,
          environment: {
            blockedCounterparties: ['0x0000000000000000000000000000000000000bad'],
          },
        },
        action: 'TRANSFER_FUNDS',
        parameters: {
          amount: 1_000,
          currency: 'USD',
          recipient: 'Joao',
          recipientAddress: '0x0000000000000000000000000000000000000BAD',
        },
      },
      'COUNTERPARTY_BLOCKED',
    ],
  ];

  for (const [name, over, expected] of cases) {
    it(`denies: ${name}`, () => {
      const r = evaluate(input(over));
      expect(r.decision).toBe('DENY');
      expect(r.reasonCode).toBe(expected);
    });
  }

  it('short-circuits: a denial stops the pipeline where it failed', () => {
    const r = evaluate(input({ action: 'LAUNCH_MISSILES' }));
    const last = r.trace[r.trace.length - 1];
    expect(last?.step).toBe(3);
    expect(last?.passed).toBe(false);
  });
});

describe('step-up', () => {
  it('requires approval when risk reaches the threshold', () => {
    const r = evaluate(
      input({
        policy: { ...salesPolicy, permissions: [...salesPolicy.permissions, 'CHANGE_POLICY'] },
        action: 'CHANGE_POLICY',
        parameters: { policyId: 'pol_2' },
      }),
    );
    expect(r.decision).toBe('REQUIRE_APPROVAL');
    expect(r.risk).toBe('HIGH');
    expect(r.reasonCode).toBe('APPROVAL_REQUIRED_RISK');
  });

  it('escalates risk on a flagged counterparty and demands approval', () => {
    const r = evaluate(
      input({
        policy: { ...treasuryPolicy, stepUpThreshold: 'HIGH' },
        action: 'TRANSFER_FUNDS',
        parameters: {
          amount: 1_000,
          currency: 'USD',
          recipient: 'Joao',
          recipientAddress: '0x00000000000000000000000000000000000000ff',
        },
        riskSignals: [
          {
            source: 'NANSEN',
            subjectAddress: '0x00000000000000000000000000000000000000ff',
            labels: ['Tornado Cash User'],
            severity: 90,
          },
        ],
      }),
    );
    expect(r.decision).toBe('REQUIRE_APPROVAL');
    expect(r.risk).toBe('CRITICAL');
    expect(r.riskAssessment.factors.some((f) => f.effect === 'ESCALATE')).toBe(true);
  });

  it('never lowers risk below the registry baseline', () => {
    const r = evaluate(
      input({
        policy: treasuryPolicy,
        action: 'TRANSFER_FUNDS',
        parameters: { amount: 1, currency: 'USD', recipient: 'Joao' },
      }),
    );
    expect(r.risk).toBe('CRITICAL');
  });
});
