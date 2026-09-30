import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789abcdef';
delete process.env.POLICY_REGISTRY_ADDRESS;
delete process.env.DATABASE_URL;

let token: string | undefined;
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => (token ? { value: token } : undefined) }) }));

const { demoSignIn } = await import('../src/lib/demo-signin.js');
const { getRepository } = await import('../src/lib/store.js');
const { TRADING_AGENT_ID, ensureTradingAgent } = await import('../src/lib/live-bot.js');
const { bindMessage } = await import('../src/lib/bind-message.js');
const { PATCH } = await import('../src/app/api/agents/[id]/route.js');

const REGISTERED = '0x000000000000000000000000000000000000c0de';
// A published Anvil test key standing in for a visitor's derived key.
const visitorKey = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

const bind = async (agentId: string) =>
  PATCH(
    new Request(`https://chancela.xyz/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        walletAddress: visitorKey.address,
        signature: await visitorKey.signMessage({ message: bindMessage(agentId, visitorKey.address) }),
      }),
    }),
    { params: { id: agentId } },
  );

describe('the shared demo owner and wallets', () => {
  it("cannot rebind the live trading agent's registered wallet", async () => {
    const repo = await getRepository();
    await ensureTradingAgent(repo, { tokenId: '4', wallet: REGISTERED });
    const signIn = await demoSignIn();
    if (!signIn.ok) throw new Error('demo sign-in failed');
    token = signIn.token;

    const res = await bind(TRADING_AGENT_ID);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('SHARED_DEMO_ACCOUNT');
    expect((await repo.getAgent(TRADING_AGENT_ID))?.walletAddress?.toLowerCase()).toBe(REGISTERED);
  });
});
