import { describe, expect, it } from 'vitest';
import { accountCallHash, grantDigest, orderCallHash, type Grant } from '../src/grant';

/**
 * Pinned vectors. The same numbers are asserted in
 * packages/contracts/test/ChancelaGate.t.sol (test_vectorsMatchTheTypeScript),
 * so neither side can drift from the other without a test going red.
 */
const GATE = '0x000000000000000000000000000000000000c4a7' as const;
const VENUE = '0x0000000000000000000000000000000000000be0' as const;

describe('grant encoding', () => {
  it('order call hash', () => {
    expect(orderCallHash({ market: 'MON/USDC', side: 'BUY', amount: 20_000 })).toMatchInlineSnapshot(`"0xdab5f126dcb911760766a7fe5eaf2013b13ddce7dc77e9884a3a1d3310acaf00"`);
  });

  it('grant digest on Monad testnet', () => {
    const grant: Grant = {
      agentTokenId: 4n,
      target: VENUE,
      callHash: orderCallHash({ market: 'MON/USDC', side: 'BUY', amount: 20_000 }),
      decisionHash: `0x${'11'.repeat(32)}`,
      policyHash: `0x${'22'.repeat(32)}`,
      expiresAt: 1_800_000_120n,
    };
    expect(grantDigest(grant, 10143, GATE)).toMatchInlineSnapshot(`"0xdc0fe68017520e2c41cac4ef6c75686615c7d57117d4e380925246a52d279c72"`);
  });

  it('every field changes the call hash', () => {
    const base = orderCallHash({ market: 'MON/USDC', side: 'BUY', amount: 20_000 });
    expect(orderCallHash({ market: 'MON/USDC', side: 'BUY', amount: 20_001 })).not.toBe(base);
    expect(orderCallHash({ market: 'MON/USDC', side: 'SELL', amount: 20_000 })).not.toBe(base);
    expect(orderCallHash({ market: 'WBTC/USDC', side: 'BUY', amount: 20_000 })).not.toBe(base);
  });
});

describe('ChancelaAccount call hash', () => {
  it('matches the vector pinned in ChancelaAccount.t.sol', () => {
    // callHash(0x…1234, 0.01 ether, deposit()) as the contract computes it.
    expect(
      accountCallHash({ target: '0x0000000000000000000000000000000000001234', value: 10_000_000_000_000_000n, data: '0xd0e30db0' }),
    ).toBe('0xfa3a282cf932cf30b843d548f9a8ba9b5be40fcaacbd0f42cf8afbb51c14a7ec');
  });

  it('moves with the value, the target and the calldata', () => {
    const base = { target: '0x0000000000000000000000000000000000001234', value: 1n, data: '0xd0e30db0' } as const;
    const h = accountCallHash(base);
    expect(accountCallHash({ ...base, value: 2n })).not.toBe(h);
    expect(accountCallHash({ ...base, target: '0x0000000000000000000000000000000000001235' })).not.toBe(h);
    expect(accountCallHash({ ...base, data: '0xd0e30db1' })).not.toBe(h);
  });
});
