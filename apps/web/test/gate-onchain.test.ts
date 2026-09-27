import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, http, keccak256, parseEther, toHex, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from '@/lib/chain';

/**
 * The web app's side of on-chain enforcement, against the real contracts.
 *
 * Starts anvil with Monad testnet's chain id, deploys the compiled registry,
 * gate and venue from packages/contracts/out, and drives lib/gate the way the
 * live bot and the attack endpoint do. What this pins down is the seam no unit
 * test covers: the grant the TypeScript attestor signs is the grant the Solidity
 * gate accepts, and the forged one is refused on-chain, with its reason.
 *
 * Skipped when anvil or the build output is missing (`forge build` first).
 */
const OUT = join(__dirname, '../../../packages/contracts/out');
const ANVIL = [process.env.ANVIL_BIN, join(homedir(), '.foundry/bin/anvil'), 'anvil'].find(
  (p) => p && (p === 'anvil' || existsSync(p)),
)!;
const haveArtifacts = existsSync(join(OUT, 'ChancelaGate.sol/ChancelaGate.json'));

// Anvil's published test accounts -- test vectors, not secrets.
const DEPLOYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const ATTESTOR = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const AGENT = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex;
const PORT = 18600 + Math.floor(Math.random() * 300);
const RPC = `http://127.0.0.1:${PORT}`;
const TOKEN = 4n;
const POLICY = keccak256(toHex('policy-v1'));

function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(join(OUT, file, `${name}.json`), 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

let anvil: ChildProcess | undefined;
let anvilUp = false;
const chain = { ...monadTestnet, rpcUrls: { default: { http: [RPC] } } };
const client = createPublicClient({ chain, transport: http(RPC), pollingInterval: 50 });
const owner = createWalletClient({ account: privateKeyToAccount(DEPLOYER), chain, transport: http(RPC), pollingInterval: 50 });
let venue: Hex;
let venueAbi: Abi;

async function deploy(file: string, name: string, args: unknown[] = []): Promise<Hex> {
  const { abi, bytecode } = artifact(file, name);
  const hash = await owner.deployContract({ abi, bytecode, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
}

async function write(address: Hex, abi: Abi, functionName: string, args: unknown[]) {
  const hash = await owner.writeContract({ address, abi, functionName, args });
  await client.waitForTransactionReceipt({ hash });
}

beforeAll(async () => {
  if (!haveArtifacts) return;
  anvil = spawn(ANVIL, ['--port', String(PORT), '--chain-id', '10143', '--silent'], { stdio: 'ignore' });
  anvil.on('error', () => undefined);
  for (let i = 0; i < 50 && !anvilUp; i++) {
    await new Promise((r) => setTimeout(r, 100));
    anvilUp = await client.getChainId().then(() => true, () => false);
  }
  if (!anvilUp) return;

  const identity = await deploy('MockIdentityRegistry.sol', 'MockIdentityRegistry');
  const registry = await deploy('TrustAgentPolicyRegistry.sol', 'TrustAgentPolicyRegistry', [identity]);
  const gate = await deploy('ChancelaGate.sol', 'ChancelaGate', [registry]);
  venue = await deploy('ChancelaDemoVenue.sol', 'ChancelaDemoVenue', [gate]);
  venueAbi = artifact('ChancelaDemoVenue.sol', 'ChancelaDemoVenue').abi;

  const idAbi = artifact('MockIdentityRegistry.sol', 'MockIdentityRegistry').abi;
  const regAbi = artifact('TrustAgentPolicyRegistry.sol', 'TrustAgentPolicyRegistry').abi;
  const agent = privateKeyToAccount(AGENT).address;
  await write(identity, idAbi, 'mint', [TOKEN, owner.account.address]);
  await write(registry, regAbi, 'setAgentWallet', [TOKEN, agent]);
  await write(registry, regAbi, 'setAttestor', [TOKEN, privateKeyToAccount(ATTESTOR).address]);
  await write(registry, regAbi, 'anchorPolicy', [TOKEN, 1, POLICY]);
  await client.waitForTransactionReceipt({
    hash: await owner.sendTransaction({ to: agent, value: parseEther('1') }),
  });

  process.env.MONAD_RPC_URL = RPC;
  process.env.ATTESTATION_PRIVATE_KEY = ATTESTOR;
  process.env.GATE_ADDRESS = gate;
  process.env.DEMO_VENUE_ADDRESS = venue;
  process.env.LIVE_AGENT_PRIVATE_KEY = AGENT;
}, 30_000);

afterAll(() => {
  anvil?.kill();
  delete process.env.MONAD_RPC_URL;
  delete process.env.ATTESTATION_PRIVATE_KEY;
  delete process.env.GATE_ADDRESS;
  delete process.env.DEMO_VENUE_ADDRESS;
  delete process.env.LIVE_AGENT_PRIVATE_KEY;
});

const decision = (n: number) => ({
  decisionHash: keccak256(toHex(`decision-${n}`)),
  policyHash: POLICY,
  expiresAt: Math.floor(Date.now() / 1000) + 120,
});
const order = { market: 'MON/USDC', side: 'BUY', amount: 20_000 };

describe.skipIf(!haveArtifacts)('on-chain enforcement against the real contracts', () => {
  it('an allowed order is accepted by the venue', async (ctx) => {
    if (!anvilUp) ctx.skip();
    const { executeAllowedOrder } = await import('@/lib/gate');
    const result = await executeAllowedOrder(TOKEN.toString(), order, decision(1));
    expect(result.status).toBe('EXECUTED');
    const receipt = await client.getTransactionReceipt({ hash: result.txHash! });
    expect(receipt.status).toBe('success');
    expect(await client.readContract({ address: venue, abi: venueAbi, functionName: 'orderCount' })).toBe(1n);
  });

  it('the same grant cannot be spent twice', async (ctx) => {
    if (!anvilUp) ctx.skip();
    const { executeAllowedOrder } = await import('@/lib/gate');
    const result = await executeAllowedOrder(TOKEN.toString(), order, decision(1));
    expect(result).toMatchObject({ status: 'REVERTED', reason: 'ALREADY_USED' });
  });

  it('a refused order sent anyway, with a grant the agent forged, reverts on-chain', async (ctx) => {
    if (!anvilUp) ctx.skip();
    const { attemptRefusedOrder } = await import('@/lib/gate');
    const result = await attemptRefusedOrder(TOKEN.toString(), { ...order, amount: 2_500_000 }, decision(2));
    expect(result).toMatchObject({ status: 'REVERTED', reason: 'BAD_SIGNATURE' });
    // A real transaction, mined and reverted -- not a failed simulation.
    const receipt = await client.getTransactionReceipt({ hash: result.txHash! });
    expect(receipt.status).toBe('reverted');
    expect(await client.readContract({ address: venue, abi: venueAbi, functionName: 'orderCount' })).toBe(1n);
  });

  it('a grant from a policy the owner has since replaced reverts', async (ctx) => {
    if (!anvilUp) ctx.skip();
    const { executeAllowedOrder } = await import('@/lib/gate');
    const stale = { ...decision(3), policyHash: keccak256(toHex('policy-v0')) };
    const result = await executeAllowedOrder(TOKEN.toString(), order, stale);
    expect(result).toMatchObject({ status: 'REVERTED', reason: 'POLICY_CHANGED' });
  });

  it('without configuration it does nothing', async () => {
    const { executeAllowedOrder } = await import('@/lib/gate');
    const saved = process.env.GATE_ADDRESS;
    delete process.env.GATE_ADDRESS;
    try {
      expect((await executeAllowedOrder('4', order, decision(9))).status).toBe('SKIPPED');
    } finally {
      process.env.GATE_ADDRESS = saved;
    }
  });
});
