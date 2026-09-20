import { describe, expect, it } from 'vitest';
import { HDKey } from '@scure/bip32';
import { privateKeyToAccount } from 'viem/accounts';
import { bytesToHex, verifyMessage } from 'viem';

process.env.ATTESTATION_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
delete process.env.POLICY_REGISTRY_ADDRESS;

const { createAgentFor } = await import('../src/lib/create-agent.js');
const { getRepository } = await import('../src/lib/store.js');
const { bindMessage } = await import('../src/lib/bind-message.js');
const { meraStatus } = await import('../src/lib/mera-status.js');

// The browser derives keys through mera; the path arithmetic is plain BIP-32,
// so it is checked here against a fixed seed without needing an authenticator.
const SEED = new Uint8Array(64).fill(7);
const at = (path: string) => {
  const node = HDKey.fromMasterSeed(SEED).derive(path);
  return privateKeyToAccount(bytesToHex(node.privateKey!));
};

describe('one passkey, many keys', () => {
  it('derives a distinct key per agent, and the owner never collides with one', () => {
    const owner = at("m/44'/60'/1'/0/0").address;
    const agents = [0, 1, 2, 3].map((i) => at(`m/44'/60'/0'/0/${i}`).address);
    expect(new Set([owner, ...agents]).size).toBe(5);
  });

  it('is deterministic: the same passkey output always yields the same keys', () => {
    expect(at("m/44'/60'/0'/0/1").address).toBe(at("m/44'/60'/0'/0/1").address);
  });
});

describe('agent creation', () => {
  it('belongs to whoever asked, not to a default owner', async () => {
    const repo = await getRepository();
    const me = at("m/44'/60'/1'/0/0").address;
    const { agent } = await createAgentFor(repo, { ownerAddress: me.toLowerCase(), name: 'Mine', permissions: ['READ_CUSTOMERS'] });
    expect(agent.ownerAddress).toBe(me); // stored checksummed
    expect(agent.ownerAddress).not.toBe(process.env.DEMO_OWNER_ADDRESS);
  });

  it('numbers derivation indices per owner, not globally', async () => {
    const repo = await getRepository();
    const me = at("m/44'/60'/1'/0/0").address;
    const second = await createAgentFor(repo, { ownerAddress: me, name: 'Mine too', permissions: [] });
    expect(second.agent.derivationIndex).toBe(1); // my second, whatever others hold

    const other = await createAgentFor(repo, { ownerAddress: at("m/44'/60'/1'/0/9").address, name: 'Theirs', permissions: [] });
    expect(other.agent.derivationIndex).toBe(0);
  });

  it('starts a new agent able to do only what it was given', async () => {
    const repo = await getRepository();
    const { agent, policy } = await createAgentFor(repo, { ownerAddress: at("m/44'/60'/1'/0/5").address, name: 'Starter', permissions: ['READ_CUSTOMERS'] });
    expect(policy.document.permissions).toEqual(['READ_CUSTOMERS']);
    expect(policy.document.limits.maxTransactionValue).toBe(0);
    expect((await repo.getActivePolicy(agent.id))!.version).toBe(1);
  });
});

describe('binding a wallet', () => {
  const key = at("m/44'/60'/0'/0/0");

  it('verifies when the derived key signs for that agent and address', async () => {
    const signature = await key.signMessage({ message: bindMessage('TA-001', key.address) });
    expect(await verifyMessage({ address: key.address, message: bindMessage('TA-001', key.address), signature })).toBe(true);
  });

  it('cannot be replayed onto another agent', async () => {
    const signature = await key.signMessage({ message: bindMessage('TA-001', key.address) });
    expect(await verifyMessage({ address: key.address, message: bindMessage('TA-002', key.address), signature })).toBe(false);
  });

  it('cannot claim an address whose key did not sign', async () => {
    const victim = at("m/44'/60'/0'/0/3").address;
    const signature = await key.signMessage({ message: bindMessage('TA-001', victim) });
    expect(await verifyMessage({ address: victim, message: bindMessage('TA-001', victim), signature })).toBe(false);
  });
});

describe('mera status', () => {
  it('reports connected only once a key is actually bound', async () => {
    const repo = await getRepository();
    const before = await meraStatus(repo);
    const boundBefore = before.status === 'CONNECTED';

    const { agent } = await createAgentFor(repo, { ownerAddress: at("m/44'/60'/1'/0/6").address, name: 'Unbound', permissions: [] });
    // Creating a MERA-provider agent is not evidence of anything.
    expect((await meraStatus(repo)).status).toBe(boundBefore ? 'CONNECTED' : 'NOT_CONFIGURED');

    await repo.updateAgent(agent.id, { walletAddress: at("m/44'/60'/0'/0/0").address, walletProvider: 'MERA' });
    expect((await meraStatus(repo)).status).toBe('CONNECTED');
  });
});
