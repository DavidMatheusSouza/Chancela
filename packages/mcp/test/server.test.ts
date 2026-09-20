import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { ChancelaError, type ChancelaClient, type Decision } from '../../sdk/src/index';
import { createServer } from '../src/server';

const decision = (over: Partial<Decision> = {}): Decision =>
  ({
    decision: 'ALLOW',
    reasonCode: 'OK',
    reasonText: 'Authorized by policy.',
    risk: 'LOW',
    auditId: 'TA-AUDIT-1',
    policyVersion: 3,
    policyHash: `0x${'ab'.repeat(32)}`,
    decisionHash: `0x${'cd'.repeat(32)}`,
    capsule: {} as Decision['capsule'],
    signature: '0x00',
    attestationAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    anchorStatus: 'PENDING',
    ...over,
  }) as Decision;

function fake(over: Partial<ChancelaClient>): ChancelaClient {
  return {
    authorize: vi.fn(async () => decision()),
    verify: vi.fn(async () => ({ ok: true, code: 'OK' as const })),
    guard: vi.fn(),
    proof: vi.fn(async () => ({ verified: true })),
    passport: vi.fn(async () => ({ agent: { id: 'TA-001', name: 'SalesAgent', status: 'ACTIVE', erc8004TokenId: '1' }, policy: null })),
    ...over,
  } as unknown as ChancelaClient;
}

async function connect(client: ChancelaClient, verifying = true) {
  const server = createServer({
    apiUrl: 'https://chancela.test',
    defaultAgentId: 'TA-001',
    ...(verifying ? { registry: '0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e' as const, rpcUrl: 'http://rpc.test' } : {}),
    client,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test-agent', version: '0' });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { body: JSON.parse(r.content[0]!.text), isError: Boolean(r.isError) };
  };
  return { mcp, call };
}

describe('chancela-mcp', () => {
  it('offers the gate, the passport and the proof', async () => {
    const { mcp } = await connect(fake({}));
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['chancela_authorize', 'chancela_passport', 'chancela_proof']);
  });

  it('tells the model, in the tool description, not to argue with a refusal', async () => {
    const { mcp } = await connect(fake({}));
    const gate = (await mcp.listTools()).tools.find((t) => t.name === 'chancela_authorize')!;
    expect(gate.description).toMatch(/BEFORE performing it/);
    expect(gate.description).toMatch(/do not rephrase/);
  });

  it('authorizes only what is allowed and verifies', async () => {
    const client = fake({});
    const { call } = await connect(client);
    const { body, isError } = await call('chancela_authorize', { action: 'CREATE_CUSTOMER', parameters: { name: 'Maria' } });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ authorized: true, decision: 'ALLOW', verified: true, auditId: 'TA-AUDIT-1' });
    expect(client.verify).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'TA-001',
      action: 'CREATE_CUSTOMER',
      parameters: { name: 'Maria' },
    });
  });

  it('does not authorize an ALLOW that fails verification', async () => {
    const { call } = await connect(fake({ verify: vi.fn(async () => ({ ok: false, code: 'WRONG_ATTESTOR' as const })) }));
    const { body, isError } = await call('chancela_authorize', { action: 'TRANSFER_FUNDS', parameters: { amount: 1 } });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ authorized: false, decision: 'ALLOW', verified: false, verification: 'WRONG_ATTESTOR' });
    expect(body.rule).toMatch(/do not retry/);
  });

  it('passes a refusal on with the rule attached', async () => {
    const { call } = await connect(
      fake({ authorize: vi.fn(async () => decision({ decision: 'DENY', reasonCode: 'PERMISSION_DENIED', reasonText: 'No permission.' })) }),
    );
    const { body, isError } = await call('chancela_authorize', { action: 'TRANSFER_FUNDS', parameters: {} });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ authorized: false, decision: 'DENY' });
    expect(body.rule).toMatch(/do not rephrase/);
  });

  it('treats an unreachable deployment as a refusal', async () => {
    const { call } = await connect(
      fake({ authorize: vi.fn(async () => { throw new ChancelaError('UNREACHABLE', 'Could not reach Chancela.'); }) }),
    );
    const { body, isError } = await call('chancela_authorize', { action: 'SEND_MESSAGE', parameters: {} });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ authorized: false, error: 'UNREACHABLE' });
  });

  it('says so when it is not verifying, instead of implying it did', async () => {
    const { call } = await connect(fake({}), false);
    const { body } = await call('chancela_authorize', { action: 'CREATE_CUSTOMER', parameters: {} });
    expect(body.verified).toMatch(/not checked/);
  });
});
