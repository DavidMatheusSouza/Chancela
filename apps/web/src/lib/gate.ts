import {
  GATE_REASONS,
  GRANT_TYPES,
  grantDomain,
  orderCallHash,
  type GateReason,
  type Grant,
  type Hex,
} from '@chancela/shared';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  formatEther,
  parseEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signGrant } from './attestation';
import { activeChain, rpc } from './chain';

/**
 * On-chain enforcement for the live trading agent.
 *
 * Authorizing an order was always real; executing one was not -- the executor
 * refuses to move value, so "the order was stopped" rested on our word. Here an
 * allowed order is sent by the agent's own wallet to ChancelaDemoVenue, which
 * asks ChancelaGate before accepting it. And when the policy refuses, the agent
 * is made to disobey: it goes straight to the venue anyway, with a grant it
 * signed itself, and Monad reverts the transaction. Both land on the explorer.
 *
 * Off unless GATE_ADDRESS, DEMO_VENUE_ADDRESS and LIVE_AGENT_PRIVATE_KEY are set.
 */

export const VENUE_ABI = [
  {
    type: 'function',
    name: 'placeOrder',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'market', type: 'string' },
      { name: 'side', type: 'string' },
      { name: 'amount', type: 'uint256' },
      {
        name: 'grant',
        type: 'tuple',
        components: [
          { name: 'agentTokenId', type: 'uint256' },
          { name: 'target', type: 'address' },
          { name: 'callHash', type: 'bytes32' },
          { name: 'decisionHash', type: 'bytes32' },
          { name: 'policyHash', type: 'bytes32' },
          { name: 'expiresAt', type: 'uint64' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  { type: 'error', name: 'Refused', inputs: [{ name: 'reason', type: 'uint8' }] },
] as const;

export interface GateConfig {
  gate: Hex;
  venue: Hex;
  agentKey: Hex;
  rpcUrl: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function gateConfig(): GateConfig | null {
  const gate = process.env.GATE_ADDRESS;
  const venue = process.env.DEMO_VENUE_ADDRESS;
  const agentKey = process.env.LIVE_AGENT_PRIVATE_KEY;
  if (!gate || !venue || !agentKey) return null;
  if (!ADDRESS.test(gate) || !ADDRESS.test(venue) || !/^0x[0-9a-fA-F]{64}$/.test(agentKey)) return null;
  return {
    gate: gate as Hex,
    venue: venue as Hex,
    agentKey: agentKey as Hex,
    rpcUrl: process.env.MONAD_RPC_URL ?? activeChain().rpcUrls.default.http[0],
  };
}

export interface OrderParams {
  market: string;
  side: string;
  amount: number;
}

export interface VenueResult {
  /** EXECUTED: the venue took the order. REVERTED: the gate refused it on-chain. */
  status: 'EXECUTED' | 'REVERTED' | 'SKIPPED' | 'FAILED';
  txHash?: Hex;
  blockNumber?: string;
  reason?: GateReason;
  venue?: Hex;
  error?: string;
}

/**
 * Gas limits, fixed rather than estimated: estimation refuses to build a
 * transaction that will revert, and the reverted one is the point. Monad bills
 * the limit, not the gas used. Foundry measures at most ~105k of execution for
 * an accepted order, before the 21k base and calldata; Monad prices cold state
 * higher than Ethereum, hence the headroom.
 */
const GAS_EXECUTE = 250_000n;
const GAS_REFUSED = 160_000n;

/** Below this the agent stops sending, so the wallet never runs dry mid-demo. */
const MIN_AGENT_BALANCE = parseEther('0.05');

/**
 * Refused attempts sent per hour, across all visitors. Each costs real gas --
 * about 0.016 MON at testnet's ~100 gwei -- and one reverted transaction on the
 * explorer proves as much as forty. Past the cap the refusal still happens, in
 * the policy engine and the anchor; only the extra trip to the venue is skipped.
 */
const REFUSALS_PER_HOUR = 12;
const refusalTimes: number[] = [];

function takeRefusalSlot(now = Date.now()): boolean {
  while (refusalTimes.length && refusalTimes[0]! < now - 3_600_000) refusalTimes.shift();
  if (refusalTimes.length >= REFUSALS_PER_HOUR) return false;
  refusalTimes.push(now);
  return true;
}

/** One agent key, so its transactions go out one at a time, like the anchors. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function clients(config: GateConfig) {
  const chain = activeChain();
  const account = privateKeyToAccount(config.agentKey);
  return {
    account,
    wallet: createWalletClient({ account, chain, transport: rpc(config.rpcUrl) }),
    // viem polls for receipts every 4s by default; Monad makes a block in ~0.4s,
    // and a visitor is watching this one.
    client: createPublicClient({ chain, transport: rpc(config.rpcUrl), pollingInterval: 500 }),
  };
}

/** The gate's answer for a call, read before sending so the UI can name it. */
function reasonOf(err: unknown): GateReason | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName === 'Refused') {
    return GATE_REASONS[Number(revert.data.args?.[0])];
  }
  return undefined;
}

async function send(
  config: GateConfig,
  order: OrderParams,
  grant: Grant,
  signature: Hex,
  gas: bigint,
): Promise<VenueResult> {
  return enqueue(async () => {
    const { account, wallet, client } = clients(config);
    const balance = await client.getBalance({ address: account.address });
    if (balance < MIN_AGENT_BALANCE) {
      return { status: 'SKIPPED', error: `agent wallet low: ${formatEther(balance)} MON` };
    }
    const call = {
      address: config.venue,
      abi: VENUE_ABI,
      functionName: 'placeOrder',
      args: [order.market, order.side, BigInt(order.amount), grant, signature],
      account,
    } as const;

    let reason: GateReason | undefined;
    try {
      await client.simulateContract(call);
    } catch (err) {
      reason = reasonOf(err);
      if (!reason) return { status: 'FAILED', error: (err as Error).message.slice(0, 300) };
    }

    try {
      const txHash = await wallet.writeContract({ ...call, gas });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
      return {
        status: receipt.status === 'success' ? 'EXECUTED' : 'REVERTED',
        txHash,
        blockNumber: receipt.blockNumber.toString(),
        reason: receipt.status === 'success' ? undefined : (reason ?? 'BAD_SIGNATURE'),
        venue: config.venue,
      };
    } catch (err) {
      return { status: 'FAILED', error: (err as Error).message.slice(0, 300) };
    }
  });
}

function grantFor(
  config: GateConfig,
  agentTokenId: string,
  order: OrderParams,
  decision: { decisionHash: Hex; policyHash: Hex; expiresAt: number },
): Grant {
  return {
    agentTokenId: BigInt(agentTokenId),
    target: config.venue,
    callHash: orderCallHash(order),
    decisionHash: decision.decisionHash,
    policyHash: decision.policyHash,
    expiresAt: BigInt(decision.expiresAt),
  };
}

/** Carry out an allowed order: attestor signs the grant, agent sends it to the venue. */
export async function executeAllowedOrder(
  agentTokenId: string,
  order: OrderParams,
  decision: { decisionHash: Hex; policyHash: Hex; expiresAt: number },
): Promise<VenueResult> {
  const config = gateConfig();
  if (!config) return { status: 'SKIPPED', error: 'gate not configured' };
  const grant = grantFor(config, agentTokenId, order, decision);
  const signature = await signGrant(grant, activeChain().id, config.gate);
  return send(config, order, grant, signature, GAS_EXECUTE);
}

/**
 * The agent ignores a refusal and goes to the venue anyway.
 *
 * It has no grant for this order -- the policy said no, so the attestor never
 * signed one -- so it signs one with its own key, which is the most a
 * compromised agent could do. The gate checks the signer against the attestor
 * the owner registered on Monad, and the transaction reverts.
 */
export async function attemptRefusedOrder(
  agentTokenId: string,
  order: OrderParams,
  decision: { decisionHash: Hex; policyHash: Hex; expiresAt: number },
): Promise<VenueResult> {
  const config = gateConfig();
  if (!config) return { status: 'SKIPPED', error: 'gate not configured' };
  if (!takeRefusalSlot()) return { status: 'SKIPPED', error: 'hourly budget for on-chain refusals spent' };
  const grant = grantFor(config, agentTokenId, order, decision);
  const forged = await privateKeyToAccount(config.agentKey).signTypedData({
    domain: grantDomain(activeChain().id, config.gate),
    types: GRANT_TYPES,
    primaryType: 'Grant',
    message: grant,
  });
  return send(config, order, grant, forged as Hex, GAS_REFUSED);
}

/** Pull the venue's order fields out of PLACE_ORDER parameters. */
export function orderFrom(parameters: Record<string, unknown>): OrderParams | null {
  const { market, side, amount } = parameters;
  if (typeof market !== 'string' || typeof side !== 'string' || typeof amount !== 'number') return null;
  return { market, side, amount };
}
