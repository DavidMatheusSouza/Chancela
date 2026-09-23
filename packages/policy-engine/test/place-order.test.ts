import { hashIntent, type PolicyDocument } from '@chancela/shared';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index';
import { input } from './fixtures';

const DEX = '0x1111111111111111111111111111111111111111';
const BAD_DEX = '0x2222222222222222222222222222222222222222';

// 50_000 cents = $500 per order, $1,500 a day, 20 orders a day.
const tradingPolicy: PolicyDocument = {
  agentId: 'TA-001',
  name: 'TradingAgent',
  version: 1,
  permissions: ['PLACE_ORDER'],
  limits: { maxTransactionValue: 50_000, dailyTransactions: 20, dailyValueCap: 150_000 },
  stepUpThreshold: 'CRITICAL',
  environment: { blockedCounterparties: [BAD_DEX] },
};

const order = { amount: 10_000, market: 'MON/USDC', side: 'BUY', marketAddress: DEX };

function place(parameters: Record<string, unknown>, over: Parameters<typeof input>[0] = {}) {
  return evaluate(input({ policy: tradingPolicy, action: 'PLACE_ORDER', parameters, ...over }));
}

describe('PLACE_ORDER', () => {
  it('lets an ordinary order through without a human', () => {
    const r = place(order);
    expect(r.decision).toBe('ALLOW');
    expect(r.risk).toBe('HIGH');
  });

  it('asks the owner for an order near the per-order ceiling', () => {
    const r = place({ ...order, amount: 45_000 });
    expect(r.decision).toBe('REQUIRE_APPROVAL');
    expect(r.reasonCode).toBe('APPROVAL_REQUIRED_AMOUNT');
    expect(r.risk).toBe('CRITICAL');
  });

  it('refuses an order above the per-order ceiling', () => {
    const r = place({ ...order, amount: 50_001 });
    expect(r.decision).toBe('DENY');
    expect(r.reasonCode).toBe('LIMIT_EXCEEDED');
  });

  it('refuses an order that would cross the daily cap', () => {
    const r = place(order, { usage: { transactionsToday: 3, valueMovedToday: 145_000 } });
    expect(r.decision).toBe('DENY');
    expect(r.reasonCode).toBe('DAILY_LIMIT_EXCEEDED');
  });

  it('refuses the order after the daily count is spent', () => {
    const r = place(order, { usage: { transactionsToday: 20, valueMovedToday: 0 } });
    expect(r.reasonCode).toBe('DAILY_LIMIT_EXCEEDED');
  });

  it('refuses a market contract the owner blocked, whatever its case', () => {
    const r = place({ ...order, marketAddress: BAD_DEX.toUpperCase().replace('0X', '0x') });
    expect(r.decision).toBe('DENY');
    expect(r.reasonCode).toBe('COUNTERPARTY_BLOCKED');
  });

  it('is not granted by TRANSFER_FUNDS', () => {
    const r = place(order, { policy: { ...tradingPolicy, permissions: ['TRANSFER_FUNDS'] } });
    expect(r.reasonCode).toBe('PERMISSION_DENIED');
  });

  it.each([
    ['a float amount', { ...order, amount: 100.5 }],
    ['an unknown side', { ...order, side: 'SHORT' }],
    ['a float size', { ...order, size: 1.5 }],
    ['a LIMIT order without a price', { ...order, orderType: 'LIMIT' }],
    ['an unknown field', { ...order, leverage: 50 }],
    ['no market', { amount: 10_000, side: 'BUY' }],
  ])('rejects %s', (_label, parameters) => {
    expect(place(parameters as Record<string, unknown>).reasonCode).toBe('INVALID_PARAMETERS');
  });

  it('hashes the order exactly as sent, so the integrator can verify it', () => {
    const plain = place(order);
    // What the SDK computes on the integrator's side from the object they pass to guard().
    expect(plain.intentHash).toBe(hashIntent({ agentId: 'TA-001', action: 'PLACE_ORDER', parameters: order }));
    const withOptional = place({ ...order, orderType: 'MARKET' });
    // No defaults are filled in: an omitted field and an explicit one are different intents.
    expect(plain.intentHash).not.toBe(withOptional.intentHash);
  });
});
