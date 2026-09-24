/**
 * Register the live ledger's trading agent (TA-007) on-chain and in the store.
 *
 * The same four steps as scripts/register-agents.ts -- mint the ERC-8004
 * identity, bind the agent wallet, set the attestor, anchor the policy -- with
 * the policy document and hash taken from apps/web/src/lib/live-bot.ts, the
 * code the service evaluates, so the anchored hash cannot drift from the served
 * one. Then the agent and its policy are written to this deployment's store.
 *
 * Resumable: it stops before spending gas when the store already has the
 * agent, and refuses outright when TA-007 belongs to somebody else.
 *
 *   set -a; . ./.env; set +a; pnpm tsx scripts/register-trading-agent.ts
 */
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, getAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  TRADING_AGENT_ID,
  TRADING_AGENT_NAME,
  TRADING_POLICY,
  ensureTradingAgent,
  tradingPolicyHash,
} from '../apps/web/src/lib/live-bot';
import { getRepository } from '../apps/web/src/lib/store';

const RPC = process.env.MONAD_RPC_URL ?? process.env.MONAD_TESTNET_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const IDENTITY = process.env.ERC8004_IDENTITY_REGISTRY as Hex;
const POLICY = process.env.POLICY_REGISTRY_ADDRESS as Hex;
const DEPLOYER = process.env.DEPLOYER_PRIVATE_KEY as Hex;
const ATTESTATION = process.env.ATTESTATION_PRIVATE_KEY as Hex;
const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3080';

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  testnet: true,
});

const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'agentCardUri', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  { type: 'function', name: 'totalRegistered', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const POLICY_ABI = [
  {
    type: 'function',
    name: 'setAgentWallet',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentTokenId', type: 'uint256' },
      { name: 'wallet', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setAttestor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentTokenId', type: 'uint256' },
      { name: 'attestor', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'anchorPolicy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentTokenId', type: 'uint256' },
      { name: 'version', type: 'uint32' },
      { name: 'policyHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'activePolicy',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [
      { name: 'policyHash', type: 'bytes32' },
      { name: 'version', type: 'uint32' },
      { name: 'anchoredAt', type: 'uint64' },
    ],
  },
] as const;

/**
 * The agent's wallet. It authorizes orders and never sends one, so it needs an
 * address the registry can bind but no key: derived from a label, nobody holds it.
 */
const AGENT_WALLET = getAddress(`0x${keccak256(toHex('chancela:TA-007:trading-agent')).slice(-40)}`);

async function main() {
  for (const [name, value] of Object.entries({ IDENTITY, POLICY, DEPLOYER, ATTESTATION })) {
    if (!value) throw new Error(`Missing env: ${name}`);
  }
  if (!process.env.DATABASE_URL) throw new Error('Missing env: DATABASE_URL (the agent must land in the live store)');

  const repo = await getRepository();
  const existing = await repo.getAgent(TRADING_AGENT_ID);
  if (existing && existing.name !== TRADING_AGENT_NAME) {
    throw new Error(`${TRADING_AGENT_ID} already belongs to "${existing.name}". Refusing to touch it.`);
  }
  if (existing?.erc8004TokenId) {
    console.log(`${TRADING_AGENT_ID} already registered as token #${existing.erc8004TokenId}. Nothing to do.`);
    return;
  }

  const owner = privateKeyToAccount(DEPLOYER);
  const attestor = privateKeyToAccount(ATTESTATION);
  const client = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ account: owner, chain: monadTestnet, transport: http(RPC) });
  const policyHash = tradingPolicyHash();

  console.log(`owner    ${owner.address}`);
  console.log(`attestor ${attestor.address}`);
  console.log(`wallet   ${AGENT_WALLET}`);
  console.log(`policy   v${TRADING_POLICY.version} ${policyHash}\n`);

  const send = async (label: string, tx: Promise<Hex>) => {
    const hash = await tx;
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label.padEnd(15)} ${hash}`);
    return hash;
  };

  const cardUri = `${BASE_URL}/.well-known/agent-card/${TRADING_AGENT_ID}.json`;
  await send('register', wallet.writeContract({ address: IDENTITY, abi: IDENTITY_ABI, functionName: 'register', args: [owner.address, cardUri] }));
  const tokenId = await client.readContract({ address: IDENTITY, abi: IDENTITY_ABI, functionName: 'totalRegistered' });
  console.log(`tokenId         #${tokenId}`);

  // Wallet before attestor: the registry checks the attestor is not the agent's own key.
  await send('setAgentWallet', wallet.writeContract({ address: POLICY, abi: POLICY_ABI, functionName: 'setAgentWallet', args: [tokenId, AGENT_WALLET] }));
  await send('setAttestor', wallet.writeContract({ address: POLICY, abi: POLICY_ABI, functionName: 'setAttestor', args: [tokenId, attestor.address] }));
  const anchorTx = await send(
    'anchorPolicy',
    wallet.writeContract({ address: POLICY, abi: POLICY_ABI, functionName: 'anchorPolicy', args: [tokenId, TRADING_POLICY.version, policyHash] }),
  );

  const [onchainHash, onchainVersion] = await client.readContract({ address: POLICY, abi: POLICY_ABI, functionName: 'activePolicy', args: [tokenId] });
  if (onchainHash !== policyHash || onchainVersion !== TRADING_POLICY.version) {
    throw new Error(`Anchored policy does not match: ${onchainHash} v${onchainVersion}`);
  }

  await ensureTradingAgent(repo, { tokenId: tokenId.toString(), wallet: AGENT_WALLET, policyTxHash: anchorTx });
  if (existing && !existing.erc8004TokenId) {
    await repo.updateAgent(TRADING_AGENT_ID, { erc8004TokenId: tokenId.toString(), walletAddress: AGENT_WALLET });
  }
  console.log(`\n${TRADING_AGENT_ID} ${TRADING_AGENT_NAME} registered, policy verified on-chain, stored.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
