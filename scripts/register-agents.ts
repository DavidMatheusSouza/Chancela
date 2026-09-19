/**
 * Register the demo agents on-chain.
 *
 * Runs in TypeScript rather than as a Forge script on purpose: the policy hash
 * must be computed by the *same* code the running service uses, or the anchored
 * hash and the served hash silently diverge and every proof becomes unverifiable.
 * Duplicating canonicalisation in Solidity would be the obvious way to introduce
 * that bug.
 *
 *   pnpm tsx scripts/register-agents.ts
 */
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hashPolicyDocument } from '../packages/shared/src/index';

const RPC = process.env.MONAD_TESTNET_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
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
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
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
  {
    type: 'function',
    name: 'totalRegistered',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
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

/** Must stay identical to the seed in apps/web/src/lib/memory-repository.ts. */
const AGENTS = [
  {
    id: 'TA-001',
    name: 'SalesAgent',
    wallet: '0x91B2cc0F3a1b2c3D4E5F60718293A4b5c6D7E123' as Hex,
    version: 3,
    permissions: ['READ_CUSTOMERS', 'CREATE_CUSTOMER', 'SEND_PROPOSAL'],
    limits: { maxTransactionValue: 0, dailyTransactions: 0, dailyValueCap: 0 },
    stepUpThreshold: 'HIGH',
  },
  {
    id: 'TA-002',
    name: 'SupportAgent',
    wallet: '0x73c4dD0f3a1b2C3d4E5F60718293A4b5C6d7E456' as Hex,
    version: 1,
    permissions: ['READ_CUSTOMERS', 'SEND_MESSAGE'],
    limits: { maxTransactionValue: 0, dailyTransactions: 0, dailyValueCap: 0 },
    stepUpThreshold: 'MEDIUM',
  },
  {
    id: 'TA-003',
    name: 'TreasuryAgent',
    wallet: '0x55A6EE0F3a1b2C3D4E5F60718293a4b5c6d7e789' as Hex,
    version: 2,
    permissions: ['READ_TREASURY', 'TRANSFER_FUNDS'],
    limits: { maxTransactionValue: 100_000, dailyTransactions: 3, dailyValueCap: 200_000 },
    stepUpThreshold: 'CRITICAL',
  },
];

async function main() {
  for (const [name, value] of Object.entries({ IDENTITY, POLICY, DEPLOYER, ATTESTATION })) {
    if (!value) throw new Error(`Missing env: ${name}`);
  }

  const owner = privateKeyToAccount(DEPLOYER);
  const attestor = privateKeyToAccount(ATTESTATION);

  if (owner.address.toLowerCase() === attestor.address.toLowerCase()) {
    throw new Error('Deployer and attestation key must differ');
  }

  const client = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ account: owner, chain: monadTestnet, transport: http(RPC) });

  console.log(`owner    ${owner.address}`);
  console.log(`attestor ${attestor.address}\n`);

  // Idempotent per agent: a partial run must be resumable, because a failure
  // halfway through registration otherwise leaves an unrecoverable chain state.
  const registered = await client.readContract({
    address: IDENTITY,
    abi: IDENTITY_ABI,
    functionName: 'totalRegistered',
  });
  console.log(`already registered on-chain: ${registered}\n`);

  for (const [index, agent] of AGENTS.entries()) {
    const existingTokenId = BigInt(index + 1);
    if (existingTokenId <= registered) {
      const [anchoredHash] = await client.readContract({
        address: POLICY,
        abi: POLICY_ABI,
        functionName: 'activePolicy',
        args: [existingTokenId],
      });
      if (anchoredHash !== `0x${'0'.repeat(64)}`) {
        console.log(`${agent.id}  already anchored (#${existingTokenId}), skipping\n`);
        continue;
      }
    }
    const document = {
      agentId: agent.id,
      name: agent.name,
      version: agent.version,
      permissions: agent.permissions,
      limits: agent.limits,
      stepUpThreshold: agent.stepUpThreshold,
      environment: {},
    };

    const policyHash = hashPolicyDocument({
      agentId: document.agentId,
      version: document.version,
      permissions: document.permissions,
      limits: document.limits as unknown as Record<string, number>,
      stepUpThreshold: document.stepUpThreshold,
      environment: document.environment,
    });

    const cardUri = `${BASE_URL}/.well-known/agent-card/${agent.id}.json`;

    let tokenId = existingTokenId;
    if (existingTokenId > registered) {
      const mintTx = await wallet.writeContract({
        address: IDENTITY,
        abi: IDENTITY_ABI,
        functionName: 'register',
        args: [owner.address, cardUri],
      });
      await client.waitForTransactionReceipt({ hash: mintTx });
      tokenId = await client.readContract({
        address: IDENTITY,
        abi: IDENTITY_ABI,
        functionName: 'totalRegistered',
      });
    }

    // Order matters: the wallet must be known before setAttestor, so the
    // contract can enforce that the attestor is not the agent's own key.
    const walletTx = await wallet.writeContract({
      address: POLICY,
      abi: POLICY_ABI,
      functionName: 'setAgentWallet',
      args: [tokenId, agent.wallet],
    });
    await client.waitForTransactionReceipt({ hash: walletTx });

    const attestorTx = await wallet.writeContract({
      address: POLICY,
      abi: POLICY_ABI,
      functionName: 'setAttestor',
      args: [tokenId, attestor.address],
    });
    await client.waitForTransactionReceipt({ hash: attestorTx });

    const anchorTx = await wallet.writeContract({
      address: POLICY,
      abi: POLICY_ABI,
      functionName: 'anchorPolicy',
      args: [tokenId, agent.version, policyHash],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: anchorTx });

    const [onchainHash, onchainVersion] = await client.readContract({
      address: POLICY,
      abi: POLICY_ABI,
      functionName: 'activePolicy',
      args: [tokenId],
    });

    const match = onchainHash === policyHash && onchainVersion === agent.version;
    console.log(`${agent.id}  ${agent.name}`);
    console.log(`  tokenId     #${tokenId}`);
    console.log(`  policy      v${agent.version}  ${policyHash}`);
    console.log(`  anchored    ${match ? 'verified on-chain' : 'MISMATCH'}`);
    console.log(`  block       ${receipt.blockNumber}`);
    console.log(`  tx          https://testnet.monadexplorer.com/tx/${anchorTx}\n`);

    if (!match) throw new Error(`Anchored hash does not match for ${agent.id}`);
  }

  console.log('All agents registered and policies anchored.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
