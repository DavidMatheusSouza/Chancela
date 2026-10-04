/**
 * Replay: a decision can be run again by someone who was not there.
 *
 * The claim is narrow and checkable. `evaluate()` reads nothing but its input,
 * so the input -- as JSON, after a trip through a database and an HTTP
 * response -- is enough to reproduce the decision hash the attestor signed.
 * These tests pin the two halves: an honest bundle reproduces the hash, and a
 * bundle doctored in any way that matters does not.
 */
import type { PolicyDocument } from '@chancela/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bundleOf, evaluate, policyHashOf, replay } from '../src/index';
import { agent, input, salesPolicy, treasuryPolicy } from './fixtures';

const tradingPolicy: PolicyDocument = {
  agentId: 'TA-001',
  name: 'TradingAgent',
  version: 1,
  permissions: ['PLACE_ORDER'],
  limits: { maxTransactionValue: 50_000, dailyTransactions: 20, dailyValueCap: 150_000 },
  stepUpThreshold: 'CRITICAL',
  environment: {},
};
const order = { amount: 20_000, market: 'MON/USDC', side: 'BUY' };

/** What a third party holds: the bundle as served, and the hashes the chain has. */
function served(over: Parameters<typeof input>[0] = {}) {
  const evalInput = input(over);
  const original = evaluate(evalInput);
  const bundle = JSON.parse(JSON.stringify(bundleOf(evalInput)));
  return {
    original,
    bundle,
    expected: {
      decisionHash: original.decisionHash,
      policyHash: original.policyHash,
      intentHash: original.intentHash,
    },
  };
}

describe('replay', () => {
  it('reproduces an ALLOW from its bundle alone', () => {
    const { original, bundle, expected } = served({ policy: tradingPolicy, action: 'PLACE_ORDER', parameters: order });
    const verdict = replay(bundle, expected);
    expect(original.decision).toBe('ALLOW');
    expect(verdict.ok).toBe(true);
    expect(verdict.result?.decisionHash).toBe(original.decisionHash);
    expect(verdict.result?.trace).toEqual(original.trace);
  });

  it('reproduces a refusal, which is the half an operator has a reason to hide', () => {
    const { original, bundle, expected } = served({
      policy: tradingPolicy,
      action: 'PLACE_ORDER',
      parameters: { ...order, amount: 2_500_000 },
    });
    expect(original.reasonCode).toBe('LIMIT_EXCEEDED');
    expect(replay(bundle, expected).ok).toBe(true);
  });

  it('reproduces a refusal that depends on what was already spent that day', () => {
    const { original, bundle, expected } = served({
      policy: tradingPolicy,
      action: 'PLACE_ORDER',
      parameters: order,
      usage: { transactionsToday: 7, valueMovedToday: 140_000 },
    });
    expect(original.reasonCode).toBe('DAILY_LIMIT_EXCEEDED');
    expect(bundle.usage).toEqual({ transactionsToday: 7, valueMovedToday: 140_000 });
    expect(replay(bundle, expected).ok).toBe(true);
  });

  it('reproduces a suspended agent, a missing policy and an owner approval', () => {
    for (const over of [
      { agent: { ...agent, status: 'SUSPENDED' as const } },
      { policy: null },
      {
        policy: { ...treasuryPolicy, stepUpThreshold: 'HIGH' as const },
        action: 'TRANSFER_FUNDS',
        parameters: { amount: 50_000, recipientAddress: '0x1111111111111111111111111111111111111111' },
        approval: { stepUpDecisionHash: `0x${'ab'.repeat(32)}` as const },
      },
    ]) {
      const { bundle, expected } = served(over);
      expect(replay(bundle, expected).ok).toBe(true);
    }
  });

  it('writes the defaults out, so the bundle does not depend on the engine keeping them', () => {
    const bundle = bundleOf(input());
    expect(bundle.usage).toEqual({ transactionsToday: 0, valueMovedToday: 0 });
    expect(bundle.environment).toBe('production');
    expect(bundle.riskSignals).toEqual([]);
  });

  it('catches a verdict the policy does not give', () => {
    // The attestor signs DENY for an order the policy allows, and serves the
    // honest bundle: the engine, run again, says ALLOW and the hashes part.
    const honest = served({ policy: tradingPolicy, action: 'PLACE_ORDER', parameters: order });
    const lie = evaluate(input({ policy: { ...tradingPolicy, permissions: [] }, action: 'PLACE_ORDER', parameters: order }));
    expect(lie.decision).toBe('DENY');
    const verdict = replay(honest.bundle, { ...honest.expected, decisionHash: lie.decisionHash });
    expect(verdict.ok).toBe(false);
    expect(verdict.mismatch).toBe('DECISION_HASH');
    expect(verdict.result?.decision).toBe('ALLOW');
  });

  it('catches a bundle whose policy is not the one the owner anchored', () => {
    // To make a doctored verdict replay cleanly the attestor has to doctor the
    // policy too -- and then it no longer hashes to what is on Monad.
    const anchored = policyHashOf(tradingPolicy)!;
    const doctored = served({
      policy: { ...tradingPolicy, limits: { ...tradingPolicy.limits, maxTransactionValue: 10_000 } },
      action: 'PLACE_ORDER',
      parameters: order,
    });
    expect(doctored.original.decision).toBe('DENY');
    const verdict = replay(doctored.bundle, { decisionHash: doctored.original.decisionHash, policyHash: anchored });
    expect(verdict.ok).toBe(false);
    expect(verdict.mismatch).toBe('POLICY_HASH');
  });

  it('catches parameters swapped under the capsule', () => {
    const { bundle, expected } = served({ policy: tradingPolicy, action: 'PLACE_ORDER', parameters: order });
    bundle.parameters = { ...order, amount: 19_999 };
    const verdict = replay(bundle, { decisionHash: expected.decisionHash, intentHash: expected.intentHash });
    expect(verdict.ok).toBe(false);
    expect(verdict.mismatch).toBe('INTENT_HASH');
  });

  it('catches a changed nonce, time or usage', () => {
    const base = { policy: tradingPolicy, action: 'PLACE_ORDER', parameters: order };
    const { bundle, expected } = served(base);
    expect(replay({ ...bundle, nonce: 'other' }, expected).mismatch).toBe('DECISION_HASH');
    expect(replay({ ...bundle, now: bundle.now + 1 }, expected).mismatch).toBe('DECISION_HASH');
    // Usage decides the answer only near a limit; there, changing it flips the verdict.
    const nearCap = served({ ...base, usage: { transactionsToday: 7, valueMovedToday: 140_000 } });
    const relaxed = replay({ ...nearCap.bundle, usage: { transactionsToday: 0, valueMovedToday: 0 } }, nearCap.expected);
    expect(relaxed.mismatch).toBe('DECISION_HASH');
    expect(relaxed.result?.decision).toBe('ALLOW');
  });

  it('never throws on a bundle that is not one', () => {
    for (const junk of [{}, { bundle: 2 }, { bundle: 1, agent: null }, { bundle: 1, nonce: 5, now: 'x' }]) {
      const verdict = replay(junk as never, { decisionHash: `0x${'00'.repeat(32)}` });
      expect(verdict.ok).toBe(false);
      expect(verdict.mismatch).toBe('MALFORMED_BUNDLE');
    }
  });

  it('holds for any request: the bundle after JSON reproduces the hash', () => {
    fc.assert(
      fc.property(
        fc.record({
          amount: fc.integer({ min: 0, max: 5_000_000 }),
          side: fc.constantFrom('BUY', 'SELL'),
          market: fc.constantFrom('MON/USDC', 'ETH/USDC', 'mercado/ação ✓'),
          transactionsToday: fc.integer({ min: 0, max: 40 }),
          valueMovedToday: fc.integer({ min: 0, max: 300_000 }),
          now: fc.integer({ min: 1_700_000_000, max: 1_900_000_000 }),
          nonce: fc.string({ minLength: 1, maxLength: 40 }),
          policy: fc.constantFrom(tradingPolicy, salesPolicy, treasuryPolicy, null),
          action: fc.constantFrom('PLACE_ORDER', 'TRANSFER_FUNDS', 'CREATE_CUSTOMER', 'NOT_A_TOOL'),
        }),
        (r) => {
          const { bundle, expected } = served({
            policy: r.policy,
            action: r.action,
            parameters: { amount: r.amount, market: r.market, side: r.side },
            usage: { transactionsToday: r.transactionsToday, valueMovedToday: r.valueMovedToday },
            now: r.now,
            nonce: r.nonce,
          });
          return replay(bundle, expected).ok;
        },
      ),
      { numRuns: 300 },
    );
  });
});
