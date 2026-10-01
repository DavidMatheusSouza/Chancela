/**
 * Put TA-LIVE on Monad mainnet, under the official ERC-8004 registry.
 *
 * Reads the contracts deployed by the Foundry scripts from
 * packages/contracts/deployments/143.json, then, each step skipped when
 * already done:
 *   1. register an identity in the official ERC-8004 registry (owner: deployer)
 *   2. bind the agent wallet, set the attestor, anchor TA-LIVE's live policy --
 *      the same hash the deployment at chancela.xyz signs its decisions under,
 *      read from its public passport, so grants it issues verify on mainnet
 *   3. fund the attestor and the agent wallet for gas, from the deployer
 *
 * Writes agentTokenId back into deployments/143.json for the account deploy.
 *
 *   set -a; . ./.env; set +a; pnpm tsx scripts/mainnet-agent.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseAbi, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = process.env.MONAD_MAINNET_RPC_URL ?? 'https://rpc.monad.xyz';
const API = process.env.CHANCELA_API_URL ?? 'https://chancela.xyz';
const FILE = new URL('../packages/contracts/deployments/143.json', import.meta.url);
const OFFICIAL_IDENTITY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
/** Monad reverts a value transfer that leaves the sender under this. */
const RESERVE = parseEther('10');
const GAS_FUND = { attestor: parseEther('1.5'), agent: parseEther('1') };

const chain = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const ABI = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function identityRegistry() view returns (address)',
  'function setAgentWallet(uint256 agentTokenId, address wallet)',
  'function setAttestor(uint256 agentTokenId, address attestor)',
  'function anchorPolicy(uint256 agentTokenId, uint32 version, bytes32 policyHash)',
  'function agentWalletOf(uint256) view returns (address)',
  'function attestorOf(uint256) view returns (address)',
  'function activePolicy(uint256) view returns (bytes32 policyHash, uint32 version, uint64 anchoredAt)',
]);

async function main() {
  const deployed = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string | number>;
  const registry = deployed.policyRegistry as Hex;
  if (!registry) throw new Error('deployments/143.json has no policyRegistry: run the Foundry deploy first');

  const owner = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  const attestor = privateKeyToAccount(process.env.ATTESTATION_PRIVATE_KEY as Hex).address;
  const agent = privateKeyToAccount(process.env.LIVE_AGENT_PRIVATE_KEY as Hex).address;
  const client = createPublicClient({ chain, transport: http(RPC), pollingInterval: 500 });
  const wallet = createWalletClient({ account: owner, chain, transport: http(RPC) });

  if ((await client.getChainId()) !== 143) throw new Error('not Monad mainnet');
  const identity = await client.readContract({ address: registry, abi: ABI, functionName: 'identityRegistry' });
  if (identity.toLowerCase() !== OFFICIAL_IDENTITY.toLowerCase()) {
    throw new Error(`registry ${registry} is bound to ${identity}, not the official ERC-8004 registry`);
  }

  // The policy chancela.xyz evaluates TA-LIVE under, as its passport publishes it.
  const passport = (await (await fetch(`${API}/api/agents/TA-LIVE`)).json()) as {
    policy: { version: number; policyHash: Hex };
  };
  const { version, policyHash } = passport.policy;

  console.log(`deployer ${owner.address}  ${formatEther(await client.getBalance({ address: owner.address }))} MON`);
  console.log(`registry ${registry} -> official ERC-8004 ${identity}`);
  console.log(`policy   TA-LIVE v${version} ${policyHash}\n`);

  const send = async (label: string, tx: Promise<Hex>) => {
    const hash = await tx;
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label.padEnd(15)} https://monadvision.com/tx/${hash}`);
    return receipt;
  };

  // 1. Identity.
  let tokenId = deployed.agentTokenId === undefined ? undefined : BigInt(deployed.agentTokenId);
  if (tokenId === undefined) {
    const receipt = await send(
      'register',
      wallet.writeContract({ address: identity, abi: ABI, functionName: 'register', args: [`${API}/.well-known/agent-card/TA-LIVE.json`] }),
    );
    const minted = receipt.logs.find((l) => l.address.toLowerCase() === identity.toLowerCase() && l.topics.length === 4);
    if (!minted) throw new Error('no Transfer event from the identity registry');
    tokenId = BigInt(minted.topics[3]!);
    deployed.agentTokenId = Number(tokenId);
    writeFileSync(FILE, JSON.stringify(deployed));
  }
  const holder = await client.readContract({ address: identity, abi: ABI, functionName: 'ownerOf', args: [tokenId] });
  if (holder.toLowerCase() !== owner.address.toLowerCase()) throw new Error(`token #${tokenId} is held by ${holder}`);
  console.log(`identity        ERC-8004 #${tokenId}, held by the deployer`);

  // 2. Wallet before attestor: the registry refuses an attestor equal to the agent's wallet.
  if ((await client.readContract({ address: registry, abi: ABI, functionName: 'agentWalletOf', args: [tokenId] })).toLowerCase() !== agent.toLowerCase()) {
    await send('setAgentWallet', wallet.writeContract({ address: registry, abi: ABI, functionName: 'setAgentWallet', args: [tokenId, agent] }));
  }
  if ((await client.readContract({ address: registry, abi: ABI, functionName: 'attestorOf', args: [tokenId] })).toLowerCase() !== attestor.toLowerCase()) {
    await send('setAttestor', wallet.writeContract({ address: registry, abi: ABI, functionName: 'setAttestor', args: [tokenId, attestor] }));
  }
  const [live] = await client.readContract({ address: registry, abi: ABI, functionName: 'activePolicy', args: [tokenId] });
  if (live !== policyHash) {
    await send('anchorPolicy', wallet.writeContract({ address: registry, abi: ABI, functionName: 'anchorPolicy', args: [tokenId, version, policyHash] }));
  }

  // 3. Gas for the attestor and the agent, keeping the deployer above the reserve.
  for (const [name, to, amount] of [['attestor', attestor, GAS_FUND.attestor], ['agent', agent, GAS_FUND.agent]] as const) {
    const have = await client.getBalance({ address: to });
    if (have >= amount / 2n) {
      console.log(`fund ${name.padEnd(10)} already ${formatEther(have)} MON`);
      continue;
    }
    const left = (await client.getBalance({ address: owner.address })) - amount;
    if (left < RESERVE) throw new Error(`sending ${formatEther(amount)} MON would leave the deployer under Monad's 10 MON reserve; top it up`);
    await send(`fund ${name}`, wallet.sendTransaction({ to, value: amount }));
  }

  console.log(`\nDone. Next: ACCOUNT_AGENT_ID=${tokenId} forge script script/DeployAccount.s.sol --rpc-url ${RPC} --broadcast`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
