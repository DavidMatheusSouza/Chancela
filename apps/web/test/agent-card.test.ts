import { describe, expect, it } from 'vitest';

process.env.ERC8004_IDENTITY_REGISTRY = '0x41db378FE661f9c6D31B031f42107C85eCad88b7';
process.env.PUBLIC_BASE_URL = 'https://chancela.example';

const { agentCardResponse } = await import('../src/lib/agent-card.js');

const get = (file: string) => agentCardResponse(new Request(`http://127.0.0.1:3080/.well-known/agent-card/${file}`), file);

describe('the ERC-8004 registration file', () => {
  it('answers the URI the registration scripts wrote on-chain', async () => {
    const res = await get('TA-001.json');
    expect(res.status).toBe(200);
    const card = await res.json();

    expect(card.type).toBe('https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
    expect(card.name).toBe('SalesAgent');
    expect(card.active).toBe(true);
    expect(card.registrations).toEqual([
      { agentId: 1, agentRegistry: 'eip155:10143:0x41db378FE661f9c6D31B031f42107C85eCad88b7' },
    ]);
  });

  it('builds its links from the configured public origin, not the one the proxy reached', async () => {
    const card = await (await get('TA-001')).json();
    const endpoints = card.services.map((s: { endpoint: string }) => s.endpoint);

    expect(endpoints).toContain('https://chancela.example/agents/TA-001');
    expect(endpoints).toContain('https://chancela.example/api/agents/TA-001/authorize');
    expect(endpoints.some((e: string) => e.includes('127.0.0.1'))).toBe(false);
  });

  it('is a 404 for an agent that does not exist', async () => {
    expect((await get('TA-NOPE.json')).status).toBe(404);
  });
});
