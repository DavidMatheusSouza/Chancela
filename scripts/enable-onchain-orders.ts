/**
 * Let the live trading agent (TA-LIVE) take its orders to the demo venue.
 *
 * Until now TA-LIVE's registered wallet was an address nobody holds a key for:
 * it only asked for authorizations. To send orders to ChancelaDemoVenue it needs
 * a wallet it can sign with, and the registry must name that wallet, because the
 * gate only honours a grant sent by the agent's registered wallet.
 *
 * Steps, each skipped when already done:
 *   1. check GATE_ADDRESS reads POLICY_REGISTRY_ADDRESS and the venue uses that gate
 *   2. setAgentWallet(TA-LIVE, address of LIVE_AGENT_PRIVATE_KEY)  -- as the token owner
 *   3. top the agent wallet up to 1 MON for gas (from the deployer, or the
 *      attestor when the deployer is under Monad's reserve balance)
 *   4. store the new wallet on the agent row
 *
 * Needs: DEPLOYER_PRIVATE_KEY (owner of TA-LIVE's token), POLICY_REGISTRY_ADDRESS,
 * GATE_ADDRESS, DEMO_VENUE_ADDRESS, LIVE_AGENT_PRIVATE_KEY (new, e.g. `cast wallet
 * new`; never the attestor's or the deployer's), DATABASE_URL.
 *
 *   set -a; . ./.env; set +a; pnpm tsx scripts/enable-onchain-orders.ts
 */
import { createPublicClient, createWalletClient, formatEther, getAddress, http, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TRADING_AGENT_ID } from '../apps/web/src/lib/live-bot';
import { getRepository } from '../apps/web/src/lib/store';
import { monadTestnet } from '../apps/web/src/lib/chain';

const RPC = process.env.MONAD_RPC_URL ?? 'https://testnet-rpc.monad.xyz';
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value as Hex;
};

const REGISTRY_ABI = [
  { type: 'function', name: 'agentWalletOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'attestorOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'setAgentWallet', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [] },
] as const;
const GATE_ABI = [{ type: 'function', name: 'registry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const;
const VENUE_ABI = [{ type: 'function', name: 'chancelaGate', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const;

const TOP_UP_TO = parseEther('1');

async function main() {
  const registry = env('POLICY_REGISTRY_ADDRESS');
  const gate = env('GATE_ADDRESS');
  const venue = env('DEMO_VENUE_ADDRESS');
  const owner = privateKeyToAccount(env('DEPLOYER_PRIVATE_KEY'));
  const agent = privateKeyToAccount(env('LIVE_AGENT_PRIVATE_KEY'));
  const attestor = privateKeyToAccount(env('ATTESTATION_PRIVATE_KEY'));
  env('DATABASE_URL');
  if ([owner.address, attestor.address].includes(agent.address)) {
    throw new Error('LIVE_AGENT_PRIVATE_KEY must be a new key, not the deployer or the attestor');
  }

  const client = createPublicClient({ chain: monadTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ account: owner, chain: monadTestnet, transport: http(RPC) });

  // 1. The contracts are the ones this deployment's registry answers for.
  const gateRegistry = await client.readContract({ address: gate, abi: GATE_ABI, functionName: 'registry' });
  if (getAddress(gateRegistry) !== getAddress(registry)) throw new Error(`gate reads ${gateRegistry}, not ${registry}`);
  const venueGate = await client.readContract({ address: venue, abi: VENUE_ABI, functionName: 'chancelaGate' });
  if (getAddress(venueGate) !== getAddress(gate)) throw new Error(`venue asks ${venueGate}, not ${gate}`);
  console.log(`gate      ${gate} -> registry ${registry}`);
  console.log(`venue     ${venue} -> gate`);

  const repo = await getRepository();
  const row = await repo.getAgent(TRADING_AGENT_ID);
  if (!row?.erc8004TokenId) throw new Error(`${TRADING_AGENT_ID} is not registered on-chain in this store`);
  const tokenId = BigInt(row.erc8004TokenId);
  console.log(`agent     ${TRADING_AGENT_ID} token #${tokenId}, wallet ${agent.address}`);

  const send = async (label: string, tx: Promise<Hex>) => {
    const hash = await tx;
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label.padEnd(15)} ${hash}`);
  };

  // 2. The registry names the wallet the gate will accept orders from.
  const current = await client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: 'agentWalletOf', args: [tokenId] });
  if (getAddress(current) !== agent.address) {
    await send('setAgentWallet', wallet.writeContract({ address: registry, abi: REGISTRY_ABI, functionName: 'setAgentWallet', args: [tokenId, agent.address] }));
  } else {
    console.log('setAgentWallet  already set');
  }

  // 3. Gas for the orders, and for the refused ones the gate reverts.
  const balance = await client.getBalance({ address: agent.address });
  if (balance < TOP_UP_TO / 2n) {
    // Monad reverts a value transfer that leaves the sender under its reserve
    // balance (10 MON), and the deployer usually is under it. Pay from whichever
    // of our two keys stays above it.
    const value = TOP_UP_TO - balance;
    const RESERVE = parseEther('10');
    const payer = (await client.getBalance({ address: owner.address })) - value >= RESERVE ? owner : attestor;
    if ((await client.getBalance({ address: payer.address })) - value < RESERVE) {
      throw new Error('Neither the deployer nor the attestor stays above the 10 MON reserve after funding');
    }
    const payerWallet = createWalletClient({ account: payer, chain: monadTestnet, transport: http(RPC) });
    await send('fund agent', payerWallet.sendTransaction({ to: agent.address, value }));
  } else {
    console.log(`fund agent      already ${formatEther(balance)} MON`);
  }

  // 4. The store agrees with the chain.
  if (row.walletAddress?.toLowerCase() !== agent.address.toLowerCase()) {
    await repo.updateAgent(TRADING_AGENT_ID, { walletAddress: agent.address });
    console.log('store           wallet updated');
  }
  console.log(`\nDone. Restart the web service so it picks up GATE_ADDRESS, DEMO_VENUE_ADDRESS and LIVE_AGENT_PRIVATE_KEY.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
