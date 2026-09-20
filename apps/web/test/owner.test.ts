import { describe, expect, it } from 'vitest';

const { ownsAgent } = await import('../src/lib/owner.js');

const OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const STRANGER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

describe('agent ownership', () => {
  it('recognises the owner', () => {
    expect(ownsAgent({ address: OWNER }, { ownerAddress: OWNER })).toBe(true);
  });

  it('is indifferent to address casing, in either direction', () => {
    expect(ownsAgent({ address: OWNER.toLowerCase() }, { ownerAddress: OWNER })).toBe(true);
    expect(ownsAgent({ address: OWNER }, { ownerAddress: OWNER.toLowerCase() })).toBe(true);
  });

  it('refuses a signed-in user who owns a different agent', () => {
    // The case that mattered: a valid session is not a licence to edit
    // somebody else's policy.
    expect(ownsAgent({ address: STRANGER }, { ownerAddress: OWNER })).toBe(false);
  });

  it('refuses when there is no session', () => {
    expect(ownsAgent(null, { ownerAddress: OWNER })).toBe(false);
  });

  it('refuses a malformed address rather than throwing', () => {
    expect(ownsAgent({ address: 'not-an-address' }, { ownerAddress: OWNER })).toBe(false);
    expect(ownsAgent({ address: OWNER }, { ownerAddress: '0x123' })).toBe(false);
  });
});
