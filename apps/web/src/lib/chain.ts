import { createPublicClient, createWalletClient, decodeFunctionData, defineChain, formatEther, getAddress, http, type Hex, type HttpTransportConfig } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Every RPC transport goes through here.
 *
 * Next.js caches `fetch` on the server, POSTs included, for a year by default,
 * and viem speaks JSON-RPC over POST. Left alone, a balance, a block number,
 * a nonce or a receipt could be answered from whatever the chain said on some
 * earlier request -- and it was: /api/network/status reported blocks hundreds
 * of thousands behind. A proof layer that reads the chain from a cache is not
 * reading the chain.
 */
export function rpc(url: string, options: Omit<HttpTransportConfig, 'fetchOptions'> = {}) {
  return http(url, { ...options, fetchOptions: { cache: 'no-store' } });
}

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
  {
    type: 'function',
    name: 'agentWalletOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
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
    transport: rpc(config?.rpcUrl ?? activeChain().rpcUrls.default.http[0]),
  });
}

/**
 * The wallet the registry holds for an agent, or null when it cannot be read.
 *
 * The service stores a bound wallet itself, but that is its own word. The
 * registry entry is written by the token owner (scripts/sync-agent-wallets.ts)
 * and is what `setAttestor` is checked against, so the passport compares the
 * two rather than assuming they agree. Read-only, so it needs the registry
 * address but no key. Null means "unknown", never "mismatch"; an agent with
 * nothing registered comes back as the zero address.
 */
export async function onchainAgentWallet(agentTokenId: string): Promise<string | null> {
  const registry = process.env.POLICY_REGISTRY_ADDRESS;
  if (!registry || !/^0x[0-9a-fA-F]{40}$/.test(registry)) return null;
  try {
    const chain = activeChain();
    const client = createPublicClient({
      chain,
      transport: rpc(process.env.MONAD_RPC_URL ?? chain.rpcUrls.default.http[0], { timeout: 2_500 }),
    });
    const wallet = await client.readContract({
      address: registry as Hex,
      abi: POLICY_REGISTRY_ABI,
      functionName: 'agentWalletOf',
      args: [BigInt(agentTokenId)],
    });
    return getAddress(wallet);
  } catch {
    return null;
  }
}

/** What Monad itself says one anchoring transaction recorded. */
export interface OnchainAnchor {
  /** The transaction succeeded, targets the registry and calls `recordDecision`. */
  ok: boolean;
  decisionHash: Hex | null;
  intentHash: Hex | null;
  policyHash: Hex | null;
  from: string;
  to: string | null;
  blockNumber: string | null;
  status: 'success' | 'reverted';
}

/**
 * Read an anchoring transaction back from the chain and decode what it wrote.
 *
 * This is the check a proof page owes its reader: not "we say we anchored it",
 * but the calldata Monad executed, decoded here, so the stored decision hash
 * can be compared against what is actually on-chain. Read-only and keyless.
 * Null means the chain could not be read, never that the proof failed.
 */
export async function readAnchor(txHash: string): Promise<OnchainAnchor | null> {
  const registry = process.env.POLICY_REGISTRY_ADDRESS;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  try {
    const chain = activeChain();
    const client = createPublicClient({
      chain,
      transport: rpc(process.env.MONAD_RPC_URL ?? chain.rpcUrls.default.http[0], { timeout: 4_000 }),
    });
    const hash = txHash as Hex;
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);

    let decoded: { decisionHash: Hex; intentHash: Hex; policyHash: Hex } | null = null;
    try {
      const call = decodeFunctionData({ abi: POLICY_REGISTRY_ABI, data: tx.input });
      if (call.functionName === 'recordDecision') decoded = call.args[0];
    } catch {
      decoded = null;
    }

    const toRegistry =
      Boolean(tx.to && registry) && tx.to!.toLowerCase() === registry!.toLowerCase();
    return {
      ok: receipt.status === 'success' && toRegistry && decoded !== null,
      decisionHash: decoded?.decisionHash ?? null,
      intentHash: decoded?.intentHash ?? null,
      policyHash: decoded?.policyHash ?? null,
      from: getAddress(tx.from),
      to: tx.to ? getAddress(tx.to) : null,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
    };
  } catch {
    return null;
  }
}

/**
 * Gas one `recordDecision` costs. Monad charges the gas *limit*, not the gas
 * used, so this is the estimate viem sends rather than an execution trace;
 * measured on testnet at 92,490 and rounded up.
 */
const ANCHOR_GAS = 95_000n;

export interface AttestorFunds {
  address: string;
  balance: string;
  anchorsLeft: number;
  /** Fewer than a day of the anchor budget left: top the key up. */
  low: boolean;
}

/**
 * What the attestation key can still pay for, or null when it cannot be read.
 *
 * An empty key fails quietly -- decisions keep being made and every anchor
 * turns FAILED -- so the health check says how far away that is, in the unit
 * that matters: anchors, not MON.
 */
export async function attestorFunds(lowWatermark: number): Promise<AttestorFunds | null> {
  const config = chainConfig();
  if (!config) return null;
  try {
    const client = createPublicClient({
      chain: activeChain(),
      transport: rpc(config.rpcUrl, { timeout: 2_500 }),
    });
    const address = privateKeyToAccount(config.attestorKey).address;
    const [balance, gasPrice] = await Promise.all([client.getBalance({ address }), client.getGasPrice()]);
    const anchorsLeft = gasPrice > 0n ? Number(balance / (gasPrice * ANCHOR_GAS)) : 0;
    return { address, balance: formatEther(balance), anchorsLeft, low: anchorsLeft < lowWatermark };
  } catch {
    return null;
  }
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
    const wallet = createWalletClient({ account, chain, transport: rpc(config.rpcUrl) });
    const client = createPublicClient({ chain, transport: rpc(config.rpcUrl) });

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

export const APPROVALS_ABI = [
  {
    type: 'function',
    name: 'recordApproval',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentTokenId', type: 'uint256' },
      { name: 'decisionHash', type: 'bytes32' },
      {
        name: 'a',
        type: 'tuple',
        components: [
          { name: 'authenticatorData', type: 'bytes' },
          { name: 'clientDataJSON', type: 'string' },
          { name: 'typeIndex', type: 'uint256' },
          { name: 'challengeIndex', type: 'uint256' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'approverOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [
      { name: 'x', type: 'bytes32' },
      { name: 'y', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'approvedAt',
    stateMutability: 'view',
    inputs: [{ name: 'decisionHash', type: 'bytes32' }],
    outputs: [{ type: 'uint64' }],
  },
] as const;

export function approvalsAddress(): Hex | null {
  const address = process.env.APPROVALS_ADDRESS;
  return address && /^0x[0-9a-fA-F]{40}$/.test(address) ? (address as Hex) : null;
}

/** The approver key the registry holds for an agent, or null when it cannot be read or is unset. */
export async function onchainApprover(agentTokenId: string): Promise<{ x: Hex; y: Hex } | null> {
  const address = approvalsAddress();
  if (!address) return null;
  try {
    const chain = activeChain();
    const client = createPublicClient({
      chain,
      transport: rpc(process.env.MONAD_RPC_URL ?? chain.rpcUrls.default.http[0], { timeout: 2_500 }),
    });
    const [x, y] = await client.readContract({
      address,
      abi: APPROVALS_ABI,
      functionName: 'approverOf',
      args: [BigInt(agentTokenId)],
    });
    return /^0x0{64}$/.test(x) && /^0x0{64}$/.test(y) ? null : { x, y };
  } catch {
    return null;
  }
}

/**
 * Hand a passkey approval to ChancelaApprovals, which verifies it again with
 * Monad's P-256 precompile.
 *
 * Anyone could send this transaction -- the signature is the authority -- so
 * the attestation key does, because it is the key that already holds gas. It
 * shares the anchor queue and nonce for the same reason anchoring has them.
 * As with anchoring, a chain failure is recorded, never thrown: the approval
 * has already been verified here and acted on.
 */
export async function recordApprovalOnchain(input: {
  agentTokenId: string;
  decisionHash: Hex;
  assertion: {
    authenticatorData: Hex;
    clientDataJSON: string;
    typeIndex: bigint;
    challengeIndex: bigint;
    r: Hex;
    s: Hex;
  };
}): Promise<AnchorResult> {
  const config = chainConfig();
  const address = approvalsAddress();
  if (!config || !address) return { status: 'SKIPPED', error: 'APPROVALS_ADDRESS or chain not configured' };

  return enqueue(async () => {
    const account = privateKeyToAccount(config.attestorKey);
    const chain = activeChain();
    const wallet = createWalletClient({ account, chain, transport: rpc(config.rpcUrl) });
    const client = createPublicClient({ chain, transport: rpc(config.rpcUrl) });
    const args = [BigInt(input.agentTokenId), input.decisionHash, input.assertion] as const;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (nextNonce === null) {
          nextNonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
        }
        const nonce = nextNonce;
        const txHash = await wallet.writeContract({
          address,
          abi: APPROVALS_ABI,
          functionName: 'recordApproval',
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
        const message = err instanceof Error ? err.message : 'approval record failed';
        if (attempt === 0 && isNonceError(message)) {
          nextNonce = null;
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
