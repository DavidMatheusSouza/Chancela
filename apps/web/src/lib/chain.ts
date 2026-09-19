import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** Monad mainnet. Chain ID 143, ~300ms blocks, ~600ms finality. */
export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://monadvision.com' } },
});

/** Monad testnet. Chain ID 10143. Note: genesis was reset in Dec 2025. */
export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
});

export function activeChain() {
  const id = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143);
  return id === 143 ? monad : monadTestnet;
}

export function explorerTxUrl(txHash: string): string {
  return `${activeChain().blockExplorers.default.url}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${activeChain().blockExplorers.default.url}/address/${address}`;
}

/**
 * ERC-8004 Identity Registry, per the official Monad guide.
 * Mainnet only; no testnet address is published, so the testnet value must be
 * supplied explicitly rather than guessed.
 */
export const ERC8004_IDENTITY_REGISTRY_MAINNET =
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
export const ERC8004_REPUTATION_REGISTRY_MAINNET =
  '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as const;

export function identityRegistryAddress(): string | undefined {
  const explicit = process.env.ERC8004_IDENTITY_REGISTRY;
  if (explicit) return explicit;
  return activeChain().id === 143 ? ERC8004_IDENTITY_REGISTRY_MAINNET : undefined;
}

export const POLICY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'recordDecision',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'd',
        type: 'tuple',
        components: [
          { name: 'agentTokenId', type: 'uint256' },
          { name: 'decisionHash', type: 'bytes32' },
          { name: 'intentHash', type: 'bytes32' },
          { name: 'action', type: 'bytes4' },
          { name: 'decision', type: 'uint8' },
          { name: 'risk', type: 'uint8' },
          { name: 'policyHash', type: 'bytes32' },
        ],
      },
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

export interface ChainConfig {
  registryAddress: Hex;
  rpcUrl: string;
  attestorKey: Hex;
}

export function chainConfig(): ChainConfig | null {
  const registryAddress = process.env.POLICY_REGISTRY_ADDRESS;
  const attestorKey = process.env.ATTESTATION_PRIVATE_KEY;
  if (!registryAddress || !attestorKey) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(registryAddress)) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(attestorKey)) return null;
  return {
    registryAddress: registryAddress as Hex,
    rpcUrl: process.env.MONAD_RPC_URL ?? activeChain().rpcUrls.default.http[0],
    attestorKey: attestorKey as Hex,
  };
}

export function publicClient() {
  const config = chainConfig();
  return createPublicClient({
    chain: activeChain(),
    transport: http(config?.rpcUrl ?? activeChain().rpcUrls.default.http[0]),
  });
}

export interface AnchorResult {
  status: 'CONFIRMED' | 'FAILED' | 'SKIPPED';
  txHash?: string;
  blockNumber?: string;
  error?: string;
}

const DECISION_ORDINAL: Record<string, number> = { DENY: 0, ALLOW: 1, REQUIRE_APPROVAL: 2 };
const RISK_ORDINAL: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Write one decision to Monad.
 *
 * Called off the request path. A chain hiccup must never turn into a failed
 * authorization -- the decision already happened and is already stored; the
 * anchor is the proof catching up. Hence SKIPPED/FAILED are recorded rather
 * than thrown, and the UI shows the anchor state honestly.
 */
export async function anchorDecision(input: {
  agentTokenId: string;
  decisionHash: Hex;
  intentHash: Hex;
  actionSelector: Hex;
  decision: string;
  risk: string;
  policyHash: Hex;
}): Promise<AnchorResult> {
  const config = chainConfig();
  if (!config) {
    return { status: 'SKIPPED', error: 'POLICY_REGISTRY_ADDRESS or ATTESTATION_PRIVATE_KEY unset' };
  }

  try {
    const account = privateKeyToAccount(config.attestorKey);
    const chain = activeChain();
    const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
    const client = createPublicClient({ chain, transport: http(config.rpcUrl) });

    const txHash = await wallet.writeContract({
      address: config.registryAddress,
      abi: POLICY_REGISTRY_ABI,
      functionName: 'recordDecision',
      args: [
        {
          agentTokenId: BigInt(input.agentTokenId),
          decisionHash: input.decisionHash,
          intentHash: input.intentHash,
          action: input.actionSelector,
          decision: DECISION_ORDINAL[input.decision] ?? 0,
          risk: RISK_ORDINAL[input.risk] ?? 3,
          policyHash: input.policyHash,
        },
      ],
    });

    const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
    return {
      status: receipt.status === 'success' ? 'CONFIRMED' : 'FAILED',
      txHash,
      blockNumber: receipt.blockNumber.toString(),
    };
  } catch (err) {
    return { status: 'FAILED', error: err instanceof Error ? err.message : 'anchor failed' };
  }
}
