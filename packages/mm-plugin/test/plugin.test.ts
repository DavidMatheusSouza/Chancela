import { describe, expect, it, vi } from 'vitest';
import { createPlugin } from '../src/index';

function harness(response: unknown, ok = true) {
  const lines: string[] = [];
  let code = -1;
  const ctx = {
    print: (l: string) => lines.push(l),
    exit: (c: number) => {
      code = c;
    },
    fetch: vi.fn(async () => ({ ok, json: async () => response })) as unknown as typeof fetch,
  };
  return { ctx, lines, exitCode: () => code };
}

const plugin = createPlugin({ apiUrl: 'https://trustagent.example' });

describe('mm trustagent authorize', () => {
  it('exits 0 on ALLOW', async () => {
    const h = harness({
      decision: 'ALLOW',
      risk: 'LOW',
      reasonCode: 'OK',
      reasonText: 'Authorized by policy.',
      policyVersion: 3,
      policyHash: '0xabc',
      auditId: 'TA-AUDIT-1',
      decisionHash: '0xdef',
      anchorStatus: 'CONFIRMED',
    });
    await plugin.commands.authorize(['TA-001', 'CREATE_CUSTOMER', '{"name":"Joao"}'], h.ctx);
    expect(h.exitCode()).toBe(0);
    expect(h.lines[0]).toContain('ALLOW');
  });

  it('exits non-zero on DENY so Agent Wallet actually aborts', async () => {
    const h = harness({
      decision: 'DENY',
      risk: 'CRITICAL',
      reasonCode: 'PERMISSION_DENIED',
      reasonText: 'Agent does not have permission to perform this action.',
      policyVersion: 3,
      policyHash: '0xabc',
      auditId: 'TA-AUDIT-2',
      decisionHash: '0xdef',
      anchorStatus: 'CONFIRMED',
    });
    await plugin.commands.authorize(['TA-001', 'TRANSFER_FUNDS', '{"amount":500000}'], h.ctx);
    expect(h.exitCode()).toBe(1);
    expect(h.lines.join('\n')).toContain('PERMISSION_DENIED');
  });

  it('exits non-zero on REQUIRE_APPROVAL', async () => {
    const h = harness({
      decision: 'REQUIRE_APPROVAL',
      risk: 'CRITICAL',
      reasonCode: 'APPROVAL_REQUIRED_RISK',
      reasonText: 'Risk level requires explicit owner approval.',
      policyVersion: 2,
      policyHash: '0xabc',
      auditId: 'TA-AUDIT-3',
      decisionHash: '0xdef',
      anchorStatus: 'PENDING',
    });
    await plugin.commands.authorize(['TA-003', 'TRANSFER_FUNDS', '{"amount":1000}'], h.ctx);
    expect(h.exitCode()).toBe(1);
  });

  it('refuses malformed JSON parameters instead of sending them', async () => {
    const h = harness({});
    await plugin.commands.authorize(['TA-001', 'CREATE_CUSTOMER', '{not json'], h.ctx);
    expect(h.exitCode()).toBe(1);
    expect(h.ctx.fetch).not.toHaveBeenCalled();
  });

  it('prints usage when arguments are missing', async () => {
    const h = harness({});
    await plugin.commands.authorize([], h.ctx);
    expect(h.exitCode()).toBe(1);
    expect(h.lines[0]).toContain('usage:');
  });
});

describe('mm trustagent passport', () => {
  it('prints the passport', async () => {
    const h = harness({
      agent: { id: 'TA-001', name: 'SalesAgent', status: 'ACTIVE', erc8004TokenId: '1', walletAddress: '0x91' },
      policy: { version: 3, policyHash: '0xabc', document: { permissions: ['CREATE_CUSTOMER'] } },
      trustScore: { score: 92 },
    });
    await plugin.commands.passport(['TA-001'], h.ctx);
    expect(h.exitCode()).toBe(0);
    expect(h.lines.join('\n')).toContain('SalesAgent');
    expect(h.lines.join('\n')).toContain('CREATE_CUSTOMER');
  });
});
