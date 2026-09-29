/**
 * The gate, attacked from this machine.
 *
 * Everything in check.ts proves that a decision was signed and recorded. None
 * of it stops an agent that simply ignores a refusal and sends the transaction
 * anyway. ChancelaGate is the answer to that, and the only honest way to show
 * it works is to try: forge a grant here, with a key made up on the spot, and
 * send the live trading agent's order to the venue on Monad.
 *
 * Nothing is signed by a real key and nothing is spent. Each attempt is an
 * eth_call from the agent's own registered wallet -- the chain executes the
 * venue's code exactly as it would for a transaction and reports how it ends.
 * The service is not asked anything, so these steps run even when it is down.
 */
import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  toHex,
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Step } from './check';

/** Documented in docs/JUDGES.md, verified on Sourcify. */
export const GATE_DEFAULTS = {
  gate: '0xcbBA27Ec6DFfbC548ADd02c6B978Bf76679F6FDF' as Address,
  venue: '0x0f889Df0214052a184f8d9aC0173149722Ff2934' as Address,
  /** TA-LIVE, the trading agent on chancela.xyz/live. */
  liveTokenId: 4n,
};

/** Mirrors ChancelaGate.Reason; pinned by packages/shared/src/grant.ts. */
export const GATE_REASONS = [
  'OK',
  'WRONG_TARGET',
  'CALL_MISMATCH',
  'EXPIRED',
  'ALREADY_USED',
  'AGENT_SUSPENDED',
  'POLICY_CHANGED',
  'NOT_THE_AGENT',
  'ATTESTOR_NOT_SET',
  'BAD_SIGNATURE',
] as const;

const GRANT_COMPONENTS = [
  { name: 'agentTokenId', type: 'uint256' },
  { name: 'target', type: 'address' },
  { name: 'callHash', type: 'bytes32' },
  { name: 'decisionHash', type: 'bytes32' },
  { name: 'policyHash', type: 'bytes32' },
  { name: 'expiresAt', type: 'uint64' },
] as const;

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'agentWalletOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'attestorOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
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

const VENUE_ABI = [
  {
    type: 'function',
    name: 'chancelaGate',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'orderCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'placeOrder',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'market', type: 'string' },
      { name: 'side', type: 'string' },
      { name: 'amount', type: 'uint256' },
      { name: 'grant', type: 'tuple', components: GRANT_COMPONENTS },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'error',
    name: 'Refused',
    inputs: [{ name: 'reason', type: 'uint8' }],
  },
] as const;

const ORDER_TYPEHASH = keccak256(toHex('PLACE_ORDER(string market,string side,uint256 amount)'));

/** ChancelaDemoVenue.orderHash, computed here rather than asked of the venue. */
export function orderCallHash(market: string, side: string, amount: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
      [ORDER_TYPEHASH, keccak256(toHex(market)), keccak256(toHex(side)), amount],
    ),
  );
}

/** How an attempt ended: accepted, refused by the gate with a reason, or something else. */
export type Outcome =
  | { kind: 'accepted' }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; message: string };

export function outcomeOf(err: unknown): Outcome {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === 'Refused') {
      const code = Number(reverted.data.args?.[0]);
      return { kind: 'refused', reason: GATE_REASONS[code] ?? `reason ${code}` };
    }
    return { kind: 'error', message: err.shortMessage };
  }
  return { kind: 'error', message: (err as Error).message };
}

export interface GateOptions {
  rpc: string;
  registry: Address;
  chainId: number;
  gate?: Address;
  venue?: Address;
  tokenId?: bigint;
}

export async function checkGate(
  options: GateOptions,
  add: (s: Omit<Step, 'n'>) => boolean,
): Promise<void> {
  const gate = options.gate ?? GATE_DEFAULTS.gate;
  const venue = options.venue ?? GATE_DEFAULTS.venue;
  const tokenId = options.tokenId ?? GATE_DEFAULTS.liveTokenId;
  const chain = createPublicClient({ transport: http(options.rpc) }) as PublicClient;

  // The venue must be wired to the documented gate; a venue with its own
  // "gate" could wave anything through and the rest would prove nothing.
  let wallet: Address;
  let policyHash: Hex;
  let attestor: Address;
  try {
    const wired = await chain.readContract({ address: venue, abi: VENUE_ABI, functionName: 'chancelaGate' });
    if (wired.toLowerCase() !== gate.toLowerCase()) {
      add({ title: 'The venue executes only through the gate', ok: false, detail: `venue points at ${wired}, not ${gate}`, source: 'chain' });
      return;
    }
    [wallet, [policyHash], attestor] = await Promise.all([
      chain.readContract({ address: options.registry, abi: REGISTRY_ABI, functionName: 'agentWalletOf', args: [tokenId] }),
      chain.readContract({ address: options.registry, abi: REGISTRY_ABI, functionName: 'activePolicy', args: [tokenId] }),
      chain.readContract({ address: options.registry, abi: REGISTRY_ABI, functionName: 'attestorOf', args: [tokenId] }),
    ]);
    add({
      title: 'The venue executes only through the gate',
      ok: true,
      detail: `venue ${short(venue)} → gate ${short(gate)}; trading agent #${tokenId} is wallet ${short(wallet)}`,
      source: 'chain',
    });
  } catch (err) {
    add({ title: 'Read the venue and the trading agent', ok: false, detail: outcomeOfMessage(err), source: 'chain' });
    return;
  }

  // A grant that passes every check but the signature: right venue, right call,
  // live policy, not expired, never used. Only the key is wrong -- it was made
  // on this machine a moment ago, which is what an agent ignoring a refusal has.
  const forger = privateKeyToAccount(generatePrivateKey());
  const order = { market: 'MON/USDC', side: 'buy', amount: 20_000n };
  const grant = {
    agentTokenId: tokenId,
    target: venue,
    callHash: orderCallHash(order.market, order.side, order.amount),
    decisionHash: keccak256(toHex(`chancela-check forged ${forger.address} ${Date.now()}`)),
    policyHash,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
  };
  const signature = await forger.signTypedData({
    domain: { name: 'Chancela', version: '1', chainId: options.chainId, verifyingContract: gate },
    types: { Grant: GRANT_COMPONENTS },
    primaryType: 'Grant',
    message: grant,
  });

  const attempt = async (from: Address, amount: bigint): Promise<Outcome> => {
    try {
      await chain.simulateContract({
        account: from,
        address: venue,
        abi: VENUE_ABI,
        functionName: 'placeOrder',
        args: [order.market, order.side, amount, grant, signature],
      });
      return { kind: 'accepted' };
    } catch (err) {
      return outcomeOf(err);
    }
  };

  const expect = (title: string, outcome: Outcome, reason: string, why: string) =>
    add({
      title,
      ok: outcome.kind === 'refused' && outcome.reason === reason,
      detail:
        outcome.kind === 'accepted'
          ? 'ACCEPTED — the venue would have executed it'
          : outcome.kind === 'refused'
            ? `Monad reverted: Refused(${outcome.reason})${outcome.reason === reason ? ` — ${why}` : `, expected ${reason}`}`
            : `could not tell: ${outcome.message}`,
      source: 'chain',
    });

  expect(
    `Forge a grant here and send the agent's $${order.amount / 100n} order anyway`,
    await attempt(wallet, order.amount),
    'BAD_SIGNATURE',
    `signed by ${short(forger.address)}, not the attestor ${short(attestor)}`,
  );
  expect(
    'Same grant, order raised to $2,000',
    await attempt(wallet, 200_000n),
    'CALL_MISMATCH',
    'the venue hashes the call it actually received',
  );
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  expect(
    'Same grant, sent from a wallet that is not the agent',
    await attempt(stranger, order.amount),
    'NOT_THE_AGENT',
    `${short(stranger)} is not ${short(wallet)}`,
  );

  // What did get through, if anything: every order the venue ever accepted went
  // past these same checks with the attestor's own signature.
  try {
    const count = await chain.readContract({ address: venue, abi: VENUE_ABI, functionName: 'orderCount' });
    if (count > 0n) {
      add({
        title: 'Orders the venue has accepted, each with a real grant',
        ok: true,
        detail: `orderCount() = ${count} — events on ${short(venue)} name the decision each one carried out`,
        source: 'chain',
      });
    }
  } catch {
    // Informational only; the refusals above are the check.
  }
}

function outcomeOfMessage(err: unknown): string {
  const o = outcomeOf(err);
  return o.kind === 'error' ? o.message : o.kind;
}

function short(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
