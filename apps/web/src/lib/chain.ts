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
 * Anchor transactions are serialised through this queue.
 *
 * Every anchor is signed by the same attestation key, so two concurrent writes
 * read the same pending nonce from the RPC and one of them is rejected. An agent
 * console sends several messages in a row, which makes that race the common
 * case rather than an edge case -- so the queue is not an optimisation, it is
 * what makes anchoring work at all.
 */
let anchorChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = anchorChain.then(task, task);
  // Keep the chain alive after a rejection; one failed anchor must not wedge
  // every later one.
  anchorChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Locally tracked nonce, so we do not depend on the RPC seeing our last tx yet. */
let nextNonce: number | null = null;

function isNonceError(message: string): boolean {
  return /nonce|already known|replacement transaction underpriced/i.test(message);
}

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

  return enqueue(async () => {
    const account = privateKeyToAccount(config.attestorKey);
    const chain = activeChain();
    const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
    const client = createPublicClient({ chain, transport: http(config.rpcUrl) });

    const args = [
      {
        agentTokenId: BigInt(input.agentTokenId),
        decisionHash: input.decisionHash,
        intentHash: input.intentHash,
        action: input.actionSelector,
        decision: DECISION_ORDINAL[input.decision] ?? 0,
        risk: RISK_ORDINAL[input.risk] ?? 3,
        policyHash: input.policyHash,
      },
    ] as const;

    // One retry, because the only expected transient failure is a stale local
    // nonce -- which is fixed by re-reading it, not by waiting.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (nextNonce === null) {
          nextNonce = await client.getTransactionCount({
            address: account.address,
            blockTag: 'pending',
          });
        }

        const nonce = nextNonce;
        const txHash = await wallet.writeContract({
          address: config.registryAddress,
          abi: POLICY_REGISTRY_ABI,
          functionName: 'recordDecision',
          args,
          nonce,
        });
        nextNonce = nonce + 1;

        const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
        return {
          status: receipt.status === 'success' ? ('CONFIRMED' as const) : ('FAILED' as const),
          txHash,
          blockNumber: receipt.blockNumber.toString(),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'anchor failed';
        if (attempt === 0 && isNonceError(message)) {
          nextNonce = null; // resync from the node and try once more
          continue;
        }
        nextNonce = null;
        return { status: 'FAILED' as const, error: message.slice(0, 300) };
      }
    }
    return { status: 'FAILED' as const, error: 'exhausted retries' };
  });
}

/** Test seam: forget the cached nonce (used after a key or network change). */
export function resetAnchorNonce(): void {
  nextNonce = null;
}
