import { describe, expect, it } from 'vitest';

const { escapeXml, renderSealBadge, renderSealCard, sealResponse, standing } = await import('../src/lib/seal.js');

const base = {
  id: 'TA-005',
  name: 'TradingBot',
  status: 'ACTIVE',
  tokenId: '5',
  chainName: 'Monad Testnet',
  policyVersion: 4,
  policyHash: `0x2278${'a'.repeat(56)}4051`,
  policyAnchored: true,
  decisions: 14,
  decisionsCapped: false,
  refused: 6,
  lastDecisionAt: '2026-10-07T13:42:50.227Z',
};

const get = (file: string, query = '') => sealResponse(new Request(`http://127.0.0.1:3080/seal/${file}${query}`), file);

describe('what the seal says about an agent', () => {
  it('is green only for an active agent with an identity on the registry', () => {
    expect(standing(base).label).toBe('active');
    expect(standing({ ...base, tokenId: undefined }).label).toBe('not on-chain');
    expect(standing({ ...base, status: 'SUSPENDED' }).label).toBe('suspended');
    expect(standing({ ...base, tokenId: undefined }).color).not.toBe(standing(base).color);
  });

  it('prints the identity, the policy in force and the refusals', () => {
    const svg = renderSealCard(base);
    expect(svg).toContain('ERC-8004 #5 on Monad Testnet');
    expect(svg).toContain('Policy v4 0x2278…4051, anchored');
    expect(svg).toContain('14 decisions, 6 refused, last 7 Oct 2026');
  });

  it('does not claim an anchor or an identity that is not there', () => {
    const svg = renderSealCard({ ...base, tokenId: undefined, policyAnchored: false, decisions: 0, refused: 0, lastDecisionAt: undefined });
    expect(svg).toContain('No ERC-8004 identity yet');
    expect(svg).toContain('not anchored');
    expect(svg).toContain('No decisions yet');
    expect(svg).not.toContain('>active<');
  });

  it('says "or more" when it stopped counting', () => {
    expect(renderSealCard({ ...base, decisions: 1000, decisionsCapped: true })).toContain('1000+ decisions');
  });

  it('keeps the policy version off the badge of an agent that is not in good standing', () => {
    expect(renderSealBadge(base)).toContain('active · policy v4');
    expect(renderSealBadge({ ...base, status: 'SUSPENDED' })).not.toContain('policy v4');
  });
});

describe('an agent name is not markup', () => {
  const hostile = '</text><script>alert(1)</script><image href="https://evil.example/x"/>';

  it('escapes it everywhere it is printed', () => {
    for (const svg of [renderSealCard({ ...base, name: hostile }), renderSealBadge({ ...base, name: hostile })]) {
      expect(svg).not.toContain('<script');
      expect(svg).not.toContain('<image');
      expect(svg.match(/<svg /g)).toHaveLength(1);
    }
  });

  it('drops control characters and escapes quotes', () => {
    expect(escapeXml('a\u0000b"c\'d&e')).toBe('ab&quot;c&#39;d&amp;e');
  });
});

describe('GET /seal/<id>.svg', () => {
  it('serves an image that can be embedded from another origin and can run nothing', async () => {
    const res = await get('TA-001.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const svg = await res.text();
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('SalesAgent');
    expect(svg).toContain('height="116"');
  });

  it('has a one-line form', async () => {
    const svg = await (await get('TA-001.svg', '?style=badge')).text();
    expect(svg).toContain('height="20"');
    expect(svg).toContain('chancela');
  });

  it('is a 404 for an agent that does not exist', async () => {
    expect((await get('TA-NOPE.svg')).status).toBe(404);
  });
});
