import type { PolicyDocument } from '@chancela/shared';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index';
import { input } from './fixtures';

const SELLER = '0x1111111111111111111111111111111111111111';
const BLOCKED = '0x2222222222222222222222222222222222222222';

// $300 per purchase, $600 a day, 5 purchases a day.
const policy: PolicyDocument = {
  agentId: 'TA-001',
  name: 'FundedTrader',
  version: 1,
  permissions: ['BUY_ASSESSMENT'],
  limits: { maxTransactionValue: 30_000, dailyTransactions: 5, dailyValueCap: 60_000 },
  stepUpThreshold: 'CRITICAL',
  environment: { blockedCounterparties: [BLOCKED] },
};

const purchase = { amount: 9_900, plan: '25K-1STEP', accountSize: 2_500_000, recipientAddress: SELLER };

function buy(parameters: Record<string, unknown>, over: Parameters<typeof input>[0] = {}) {
  return evaluate(input({ policy, action: 'BUY_ASSESSMENT', parameters, ...over }));
}

describe('BUY_ASSESSMENT', () => {
  it('lets an ordinary purchase through without a human', () => {
    const r = buy(purchase);
    expect(r.decision).toBe('ALLOW');
    expect(r.risk).toBe('HIGH');
  });

  it('needs nothing but the price', () => {
    expect(buy({ amount: 9_900 }).decision).toBe('ALLOW');
  });

  it('counts the price against the limits, not the size of the account it unlocks', () => {
    // A $25,000 account for $99 is a $99 purchase.
    expect(buy({ ...purchase, accountSize: 2_500_000_00 }).decision).toBe('ALLOW');
  });

  it('asks the owner for a purchase near the ceiling', () => {
    const r = buy({ ...purchase, amount: 27_000 });
    expect(r.decision).toBe('REQUIRE_APPROVAL');
    expect(r.risk).toBe('CRITICAL');
  });

  it('refuses a purchase above the ceiling', () => {
    expect(buy({ ...purchase, amount: 30_001 }).reasonCode).toBe('LIMIT_EXCEEDED');
  });

  it('refuses the purchase that would cross the daily cap', () => {
    const r = buy(purchase, { usage: { transactionsToday: 2, valueMovedToday: 55_000 } });
    expect(r.reasonCode).toBe('DAILY_LIMIT_EXCEEDED');
  });

  it('refuses a seller the owner blocked', () => {
    expect(buy({ ...purchase, recipientAddress: BLOCKED }).reasonCode).toBe('COUNTERPARTY_BLOCKED');
  });

  it('is refused to an agent whose policy grants orders but not purchases', () => {
    const r = buy(purchase, { policy: { ...policy, permissions: ['PLACE_ORDER'] } });
    expect(r.reasonCode).toBe('PERMISSION_DENIED');
  });

  it('says which parameter was wrong', () => {
    const missing = buy({ plan: '25K-1STEP' });
    expect(missing.reasonCode).toBe('INVALID_PARAMETERS');
    expect(missing.trace.at(-1)?.detail).toMatch(/^amount: /);

    const float = buy({ amount: 99.5 });
    expect(float.trace.at(-1)?.detail).toMatch(/^amount: /);

    const extra = buy({ amount: 9_900, leverage: 100 });
    expect(extra.trace.at(-1)?.detail).toBe('unknown parameter: leverage');
  });
});
