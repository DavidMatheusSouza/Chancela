/**
 * ChancelaAccount in front of a DEX that knows nothing about Chancela.
 *
 * TA-LIVE's funds sit in a ChancelaAccount. This script asks the live
 * deployment to authorize a small MON -> USDC swap, has the attestor sign a
 * grant for exactly that router call, and the agent's wallet sends it through
 * the account: the swap executes on the DEX. Then two attacks, each sent to
 * Monad on purpose so the revert is on the record:
 *
 *   1. the same grant with ten times the value        -> Refused(CALL_MISMATCH)
 *   2. a $25,000 order the policy refused, with a grant
 *      the agent signed itself                        -> Refused(BAD_SIGNATURE)
 *
 *   set -a; . ./.env; set +a; ACCOUNT_ADDRESS=0x… pnpm tsx scripts/account-swap-demo.ts
 *
 * Testnet uses a Uniswap-V2-style router with MON/USDC liquidity; mainnet
 * (CHAIN=mainnet) uses Uniswap V3's SwapRouter02.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  http,
  parseAbi,
  parseEther,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { GATE_REASONS, GRANT_TYPES, accountCallHash, grantDomain, type Grant } from '../packages/shared/src/index';

const MAINNET = process.env.CHAIN === 'mainnet';
const NET = MAINNET
  ? {
      id: 143,
      rpc: process.env.MONAD_MAINNET_RPC_URL ?? 'https://rpc.monad.xyz',
      explorer: 'https://monadvision.com/tx/',
      wmon: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A' as Hex,
      usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Hex,
      router: '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900' as Hex, // Uniswap V3 SwapRouter02
      quoter: '0x661e93cca42afacb172121ef892830ca3b70f08d' as Hex, // Uniswap V3 QuoterV2
      venue: 'uniswap-v3',
    }
  : {
      id: 10143,
      rpc: process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz',
      explorer: 'https://testnet.monadexplorer.com/tx/',
      wmon: '0x97B3070F9Da6C002343862b35E68Bd8e22608943' as Hex, // the router's WETH()
      usdc: '0x534b2f3A21130d7a60830c2Df862319e593943A3' as Hex, // Circle USDC
      router: '0x430c23895c8D44883526e3E0B09327dAD8766660' as Hex, // V2-style router
      quoter: undefined,
      venue: 'dex-v2',
    };

const API = process.env.CHANCELA_API_URL ?? 'https://chancela.xyz';
const AGENT_ID = 'TA-LIVE';
const TOKEN_ID = BigInt(process.env.ACCOUNT_AGENT_ID ?? '4');
const gate = process.env.GATE_ADDRESS as Hex;
const account = process.env.ACCOUNT_ADDRESS as Hex;
const attestor = privateKeyToAccount(process.env.ATTESTATION_PRIVATE_KEY as Hex);
const agent = privateKeyToAccount(process.env.LIVE_AGENT_PRIVATE_KEY as Hex);
/** The order, in US cents, as the policy counts it. */
const ORDER_CENTS = Number(process.env.ORDER_CENTS ?? 100);

const chain = defineChain({
  id: NET.id,
  name: MAINNET ? 'Monad' : 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [NET.rpc] } },
});
const client = createPublicClient({ chain, transport: http(NET.rpc), pollingInterval: 500 });

const ABI = parseAbi([
  'function execute(address target, uint256 value, bytes data, (uint256 agentTokenId, address target, bytes32 callHash, bytes32 decisionHash, bytes32 policyHash, uint64 expiresAt) grant, bytes signature) returns (bytes)',
  'error Refused(uint8 reason)',
  'error CallFailed(bytes returnData)',
  'error NotThisAgent(uint256 grantedTo, uint256 accountAgent)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256)',
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160, uint32, uint256)',
  'function balanceOf(address) view returns (uint256)',
]);

/** USDC out for `value` MON. */
async function quote(value: bigint): Promise<bigint> {
  if (NET.quoter) {
    const { result } = await client.simulateContract({
      address: NET.quoter,
      abi: ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: NET.wmon, tokenOut: NET.usdc, amountIn: value, fee: 3000, sqrtPriceLimitX96: 0n }],
    });
    return result[0];
  }
  const out = await client.readContract({ address: NET.router, abi: ABI, functionName: 'getAmountsOut', args: [value, [NET.wmon, NET.usdc]] });
  return out[1]!;
}

/** The router call: swap `value` MON for at least 97% of the quote, to the account. */
function swapCall(value: bigint, minOut: bigint): Hex {
  if (NET.quoter) {
    return encodeFunctionData({
      abi: ABI,
      functionName: 'exactInputSingle',
      args: [{ tokenIn: NET.wmon, tokenOut: NET.usdc, fee: 3000, recipient: account, amountIn: value, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
    });
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  return encodeFunctionData({ abi: ABI, functionName: 'swapExactETHForTokens', args: [minOut, [NET.wmon, NET.usdc], account, deadline] });
}

async function authorize(amount: number) {
  const parameters = { amount, currency: 'USD', market: 'MON/USDC', side: 'SELL', orderType: 'MARKET', venue: NET.venue, marketAddress: NET.router };
  const res = await fetch(`${API}/api/agents/${AGENT_ID}/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'PLACE_ORDER', parameters }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`authorize: ${res.status} ${JSON.stringify(d)}`);
  return d as { decision: string; reasonCode: string; auditId: string; decisionHash: Hex; policyHash: Hex; expiresAt: number };
}

function grantFor(d: { decisionHash: Hex; policyHash: Hex; expiresAt: number }, value: bigint, data: Hex): Grant {
  return {
    agentTokenId: TOKEN_ID,
    target: account,
    callHash: accountCallHash({ target: NET.router, value, data }),
    decisionHash: d.decisionHash,
    policyHash: d.policyHash,
    expiresAt: BigInt(d.expiresAt),
  };
}

const sign = (who: typeof attestor, g: Grant) =>
  who.signTypedData({ domain: grantDomain(NET.id, gate), types: GRANT_TYPES, primaryType: 'Grant', message: g });

function reasonOf(err: unknown): string {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError && r.data?.errorName === 'Refused') return `Refused(${GATE_REASONS[Number(r.data.args?.[0])]})`;
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.shortMessage;
  }
  return (err as Error).message.slice(0, 200);
}

/** Send through the account. Reverts are sent anyway (fixed gas) so they land on-chain. */
async function send(label: string, value: bigint, data: Hex, g: Grant, signature: Hex, gas: bigint) {
  const wallet = createWalletClient({ account: agent, chain, transport: http(NET.rpc) });
  const call = { address: account, abi: ABI, functionName: 'execute', args: [NET.router, value, data, g, signature], account: agent } as const;
  let expected = 'ok';
  try {
    await client.simulateContract(call);
  } catch (err) {
    expected = reasonOf(err);
  }
  const hash = await wallet.writeContract({ ...call, gas });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  console.log(`${label.padEnd(34)} ${receipt.status === 'success' ? 'EXECUTED' : `REVERTED ${expected}`}  ${NET.explorer}${hash}`);
  return { hash, status: receipt.status };
}

async function main() {
  if (!gate || !account) throw new Error('GATE_ADDRESS and ACCOUNT_ADDRESS are required');
  console.log(`chain ${NET.id} · account ${account} · router ${NET.router}`);

  // Size the swap to the order: ORDER_CENTS worth of MON at the pool's price.
  const perMon = await quote(parseEther('1'));
  const value = (parseEther('1') * BigInt(ORDER_CENTS) * 10_000n) / perMon; // USDC has 6 decimals
  const minOut = ((await quote(value)) * 97n) / 100n;
  console.log(`order $${(ORDER_CENTS / 100).toFixed(2)} = ${formatEther(value)} MON (pool: 1 MON = ${Number(perMon) / 1e6} USDC)`);

  const balance = await client.getBalance({ address: account });
  if (balance < value * 2n) {
    throw new Error(`account holds ${formatEther(balance)} MON; send it at least ${formatEther(value * 2n)} first`);
  }
  const usdcBefore = await client.readContract({ address: NET.usdc, abi: ABI, functionName: 'balanceOf', args: [account] });

  // The allowed order.
  const ok = await authorize(ORDER_CENTS);
  console.log(`policy: ${ok.decision} ${ok.reasonCode} · ${API}/proof/${ok.auditId}`);
  if (ok.decision !== 'ALLOW') throw new Error('the small order was not allowed');
  const data = swapCall(value, minOut);
  const grant = grantFor(ok, value, data);
  const signature = await sign(attestor, grant);

  // Attack 1, before the real one so the grant is still unspent: same grant, ten times the value.
  await send('attack: same grant, 10x the value', value * 10n, data, grant, signature, 300_000n);
  // The real one.
  await send('allowed swap through the account', value, data, grant, signature, 400_000n);
  const usdcAfter = await client.readContract({ address: NET.usdc, abi: ABI, functionName: 'balanceOf', args: [account] });
  console.log(`USDC in the account: ${Number(usdcBefore) / 1e6} -> ${Number(usdcAfter) / 1e6}`);

  // Attack 2: the policy refuses $25,000; the agent forges a grant and sends it anyway.
  const no = await authorize(2_500_000);
  console.log(`policy: ${no.decision} ${no.reasonCode} · ${API}/proof/${no.auditId}`);
  const bigData = swapCall(value * 10n, 0n);
  const forgedGrant = grantFor(no, value * 10n, bigData);
  await send('attack: refused order, forged grant', value * 10n, bigData, forgedGrant, await sign(agent, forgedGrant), 300_000n);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
