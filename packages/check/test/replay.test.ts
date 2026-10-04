/**
 * `chancela-check replay`: the failure modes.
 *
 * The command is only worth quoting if it says ✗ when the service has lied.
 * So each test below is a specific lie -- a verdict the policy does not give, a
 * policy swapped after the fact, parameters swapped, a transaction that is not
 * the registry's -- served alongside an otherwise plausible record, with Monad
 * stubbed to say what it would really hold.
 */
import { bundleOf, evaluate, type EvaluateInput } from '@chancela/policy-engine';
import type { PolicyDocument } from '@chancela/shared';
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { DEFAULTS } from '../src/check';
import { replayDecision, type Anchor } from '../src/replay';

const TX = `0x${'ab'.repeat(32)}` as Hex;
const OUTCOME = { DENY: 0, ALLOW: 1, REQUIRE_APPROVAL: 2 } as const;

const policy: PolicyDocument = {
  agentId: 'TA-LIVE',
  name: 'TradingAgent',
  version: 1,
  permissions: ['PLACE_ORDER'],
  limits: { maxTransactionValue: 50_000, dailyTransactions: 20, dailyValueCap: 150_000 },
  stepUpThreshold: 'CRITICAL',
  environment: {},
};

function decide(over: Partial<EvaluateInput> = {}) {
  const input: EvaluateInput = {
    agent: { id: 'TA-LIVE', ownerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', status: 'ACTIVE', erc8004TokenId: '4' },
    policy,
    policyId: 'pol_live',
    action: 'PLACE_ORDER',
    parameters: { amount: 2_500_000, market: 'MON/USDC', side: 'BUY' },
    now: 1_790_000_000,
    nonce: 'TA-LIVE-0001',
    ...over,
  };
  return { result: evaluate(input), bundle: bundleOf(input) };
}

/** An honest record: what the service serves, and what Monad holds for it. */
function record(over: Partial<EvaluateInput> = {}) {
  const { result, bundle } = decide(over);
  const served = {
    auditId: 'TA-AUDIT-DEADBEEF',
    agentId: 'TA-LIVE',
    decisionHash: result.decisionHash,
    intentHash: result.intentHash,
    policyHash: result.policyHash,
    bundle,
    anchor: { status: 'CONFIRMED', txHash: TX as Hex | null },
  };
  const anchor: Anchor = {
    succeeded: true,
    to: DEFAULTS.registry,
    blockNumber: 123n,
    agentTokenId: 4n,
    decisionHash: result.decisionHash,
    intentHash: result.intentHash,
    policyHash: result.policyHash,
    decision: OUTCOME[result.decision],
  };
  return { result, served, anchor };
}

function run(served: unknown, anchor: Anchor | null, status = 200) {
  return replayDecision({
    id: 'TA-AUDIT-DEADBEEF',
    url: 'https://chancela.test',
    rpc: 'https://rpc.invalid',
    registry: DEFAULTS.registry,
    fetch: (async () => new Response(JSON.stringify(served), { status })) as unknown as typeof fetch,
    readAnchor: async () => anchor,
  });
}

const failed = (steps: Array<{ ok: boolean; title: string }>) => steps.filter((s) => !s.ok).map((s) => s.title);

describe('chancela-check replay', () => {
  it('passes an honest refusal and shows the engine stopping at the limit', async () => {
    const { served, anchor } = record();
    const report = await run(served, anchor);
    expect(failed(report.steps)).toEqual([]);
    expect(report.steps).toHaveLength(5);
    expect(report.outcome).toBe('DENY');
    expect(report.reasonCode).toBe('LIMIT_EXCEEDED');
    expect(report.trace.at(-1)).toMatchObject({ name: 'limits', passed: false });
  });

  it('passes an honest ALLOW', async () => {
    const { served, anchor } = record({ parameters: { amount: 20_000, market: 'MON/USDC', side: 'BUY' } });
    const report = await run(served, anchor);
    expect(failed(report.steps)).toEqual([]);
    expect(report.outcome).toBe('ALLOW');
  });

  it('fails a verdict the policy does not give', async () => {
    // The attestor refused an order its policy allows, signed and anchored the
    // refusal, and serves the true inputs. The engine here says ALLOW.
    const honest = record({ parameters: { amount: 20_000, market: 'MON/USDC', side: 'BUY' } });
    const lie = decide({ parameters: { amount: 20_000, market: 'MON/USDC', side: 'BUY' }, usage: { transactionsToday: 20, valueMovedToday: 0 } });
    expect(lie.result.decision).toBe('DENY');
    const report = await run(
      { ...honest.served, decisionHash: lie.result.decisionHash },
      { ...honest.anchor, decisionHash: lie.result.decisionHash, decision: OUTCOME.DENY },
    );
    expect(failed(report.steps)).toEqual(['Run the policy engine here']);
    expect(report.outcome).toBe('ALLOW');
  });

  it('fails inputs whose policy is not the one Monad recorded', async () => {
    // To make the lie replay, the service doctors the policy in the inputs. The
    // registry only ever recorded the hash of the policy the owner anchored.
    const honest = record();
    const doctored = decide({ policy: { ...policy, limits: { ...policy.limits, maxTransactionValue: 5_000_000, dailyValueCap: 9_000_000 } } });
    expect(doctored.result.decision).not.toBe('DENY');
    const report = await run(
      { ...honest.served, bundle: doctored.bundle, decisionHash: doctored.result.decisionHash, policyHash: doctored.result.policyHash },
      honest.anchor,
    );
    expect(failed(report.steps)).toContain('Is that the policy the owner anchored');
  });

  it('fails inputs whose parameters are not the ones decided on', async () => {
    const honest = record();
    const other = decide({ parameters: { amount: 100, market: 'MON/USDC', side: 'BUY' } });
    const report = await run({ ...honest.served, bundle: other.bundle }, honest.anchor);
    expect(failed(report.steps)).toContain('Are those the parameters that were decided on');
  });

  it('takes its expectations from Monad, not from the service', async () => {
    // Every hash the service reports is consistent with its doctored inputs;
    // only the chain disagrees. If the service's hashes were used, this passes.
    const honest = record();
    const doctored = record({ parameters: { amount: 100, market: 'MON/USDC', side: 'BUY' } });
    const report = await run(doctored.served, honest.anchor);
    expect(failed(report.steps).length).toBeGreaterThan(0);
  });

  it('fails an anchor that is not a call to the registry', async () => {
    const { served, anchor } = record();
    const report = await run(served, { ...anchor, to: '0x000000000000000000000000000000000000dEaD' });
    expect(failed(report.steps)).toContain('Read what Monad recorded for it');
  });

  it('fails an anchor that reverted, and a decision that was never anchored', async () => {
    const { served, anchor } = record();
    expect(failed((await run(served, { ...anchor, succeeded: false })).steps)).toContain('Read what Monad recorded for it');
    const unanchored = await run({ ...served, anchor: { status: 'SKIPPED', txHash: null } }, null);
    expect(failed(unanchored.steps)).toEqual(['Read what Monad recorded for it']);
  });

  it('reports the service refusing, without a tick', async () => {
    const report = await run({ error: { code: 'INPUTS_PRIVATE', message: 'not a public demo agent' } }, null, 403);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]).toMatchObject({ ok: false, detail: 'not a public demo agent' });
  });

  it('reports inputs that are not a bundle, without throwing', async () => {
    const { served, anchor } = record();
    const report = await run({ ...served, bundle: { bundle: 1 } }, anchor);
    expect(report.steps.at(-1)).toMatchObject({ ok: false });
    expect(report.steps.some((s) => s.ok && s.source === 'local')).toBe(false);
  });
});
