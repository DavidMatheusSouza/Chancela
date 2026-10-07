/**
 * Put an agent that already exists in the store on-chain.
 *
 * An owner who creates an agent in the console gets policies and signed
 * decisions straight away, but no ERC-8004 identity -- and authorize() only
 * anchors a decision for an agent that has one, so every decision of theirs
 * reads `anchorStatus: SKIPPED`. This closes that gap for one agent:
 *
 *   1. mint the ERC-8004 identity (held by the deployer, who signs for the owner)
 *   2. bind the agent wallet, when one is given with --wallet
 *   3. set the attestor
 *   4. anchor the policy that is ACTIVE in the store, hash and version as stored
 *   5. write the token id and the anchor transaction to the store
 *
 * The policy hash is recomputed here from the stored document and must equal
 * the stored hash, which is the one authorize() signs. The registry refuses a
 * decision whose policy hash is not the anchored one, so a mismatch would turn
 * every anchor into a revert.
 *
 * Without --execute it only reads and prints what it would do. Each step is
 * skipped when the chain already shows it done, so a run that stops halfway
 * can be started again; pass --token <id> when it stopped after the mint.
 * Run it again after the owner publishes a new policy version: the registry
 * keeps refusing decisions until that version is anchored too.
 *
 *   set -a; . ./.env; set +a
 *   pnpm tsx scripts/register-partner-agent.ts TA-005              # dry run
 *   pnpm tsx scripts/register-partner-agent.ts TA-005 --execute
 */
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseEventLogs, zeroAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hashPolicyDocument } from '../packages/shared/src/index';
import { getRepository } from '../apps/web/src/lib/store';
import { activeChain } from '../apps/web/src/lib/chain';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value as Hex;
};

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
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'agentCardUri', type: 'string', indexed: false },
    ],
  },
] as const;

const POLICY_ABI = [
  { type: 'function', name: 'agentWalletOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'attestorOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'setAgentWallet', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [] },
  { type: 'function', name: 'setAttestor', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [] },
  {
    type: 'function',
    name: 'anchorPolicy',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256' }, { type: 'uint32' }, { type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'activePolicy',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'policyHash', type: 'bytes32' },
      { name: 'version', type: 'uint32' },
      { name: 'anchoredAt', type: 'uint64' },
    ],
  },
] as const;

function parseArgs(argv: string[]) {
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const agentId = argv.find((arg) => /^TA-/.test(arg));
  if (!agentId) throw new Error('Usage: register-partner-agent.ts <TA-id> [--wallet 0x...] [--token <id>] [--execute]');
  const wallet = flag('--wallet');
  if (wallet && !isAddress(wallet)) throw new Error(`--wallet is not an address: ${wallet}`);
  const token = flag('--token');
  if (token && !/^\d+$/.test(token)) throw new Error(`--token is not a token id: ${token}`);
  return { agentId, wallet: wallet ? getAddress(wallet) : undefined, token, execute: argv.includes('--execute') };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const identity = env('ERC8004_IDENTITY_REGISTRY');
  const registry = env('POLICY_REGISTRY_ADDRESS');
  const owner = privateKeyToAccount(env('DEPLOYER_PRIVATE_KEY'));
  const attestor = privateKeyToAccount(env('ATTESTATION_PRIVATE_KEY'));
  const baseUrl = env('PUBLIC_BASE_URL').replace(/\/$/, '');
  env('DATABASE_URL');
  if (args.wallet && [owner.address, attestor.address].includes(args.wallet)) {
    throw new Error('--wallet must be the agent\'s own address, not the deployer or the attestor');
  }

  const chain = activeChain();
  const rpc = process.env.MONAD_RPC_URL ?? chain.rpcUrls.default.http[0];
  const client = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account: owner, chain, transport: http(rpc) });

  const repo = await getRepository();
  const agent = await repo.getAgent(args.agentId);
  if (!agent) throw new Error(`${args.agentId} is not in this store`);
  const policy = await repo.getActivePolicy(args.agentId);
  if (!policy) throw new Error(`${args.agentId} has no active policy to anchor`);

  const document = policy.document;
  const recomputed = hashPolicyDocument({
    agentId: document.agentId,
    version: document.version,
    permissions: document.permissions,
    limits: document.limits as unknown as Record<string, number>,
    stepUpThreshold: document.stepUpThreshold,
    environment: document.environment as unknown as Record<string, unknown>,
  });
  if (recomputed !== policy.policyHash || document.version !== policy.version) {
    throw new Error(`Stored policy does not hash to its stored hash: ${recomputed} vs ${policy.policyHash}`);
  }

  if (agent.erc8004TokenId && args.token && agent.erc8004TokenId !== args.token) {
    throw new Error(`${args.agentId} is already token #${agent.erc8004TokenId} in the store, not #${args.token}`);
  }
  const knownToken = agent.erc8004TokenId ?? args.token;
  const cardUri = `${baseUrl}/agent-card/${agent.id}.json`;

  console.log(`chain     ${chain.id} ${rpc}`);
  console.log(`agent     ${agent.id} "${agent.name}", owner ${agent.ownerAddress}`);
  console.log(`token     ${knownToken ? `#${knownToken}` : 'none yet'}, holder ${owner.address}`);
  console.log(`attestor  ${attestor.address}`);
  console.log(`policy    v${policy.version} ${policy.policyHash}`);
  console.log(`card      ${cardUri}`);
  console.log(args.execute ? '' : '\nDry run: nothing is sent. Add --execute to send.\n');

  const send = async (label: string, tx: () => Promise<Hex>) => {
    if (!args.execute) {
      console.log(`${label.padEnd(15)} would send`);
      return undefined;
    }
    const hash = await tx();
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
    console.log(`${label.padEnd(15)} ${hash}`);
    return receipt;
  };

  // 1. Identity.
  let tokenId: bigint | undefined = knownToken ? BigInt(knownToken) : undefined;
  if (tokenId !== undefined) {
    const holder = await client.readContract({ address: identity, abi: IDENTITY_ABI, functionName: 'ownerOf', args: [tokenId] });
    if (getAddress(holder) !== owner.address) throw new Error(`token #${tokenId} is held by ${holder}, not the deployer`);
    const uri = await client.readContract({ address: identity, abi: IDENTITY_ABI, functionName: 'tokenURI', args: [tokenId] });
    // A wrong --token would bind this agent's policy to somebody else's identity.
    if (uri !== cardUri) throw new Error(`token #${tokenId} is registered for ${uri}, not ${cardUri}`);
    console.log(`${'register'.padEnd(15)} done (#${tokenId})`);
  } else {
    const receipt = await send('register', () =>
      wallet.writeContract({ address: identity, abi: IDENTITY_ABI, functionName: 'register', args: [owner.address, cardUri] }),
    );
    if (receipt) {
      const [minted] = parseEventLogs({ abi: IDENTITY_ABI, eventName: 'AgentRegistered', logs: receipt.logs });
      if (!minted) throw new Error(`register emitted no AgentRegistered: ${receipt.transactionHash}`);
      tokenId = minted.args.tokenId;
      console.log(`${'tokenId'.padEnd(15)} #${tokenId}  (to resume: --token ${tokenId})`);
    }
  }

  if (tokenId === undefined) {
    // Dry run before the mint: the remaining steps have nothing to read yet.
    for (const label of [...(args.wallet ? ['setAgentWallet'] : []), 'setAttestor', 'anchorPolicy']) await send(label, async () => '0x');
    console.log(`${'store'.padEnd(15)} would write the token id and the anchor transaction`);
    return;
  }
  const id = tokenId;

  // 2. Wallet before attestor: the registry checks the attestor is not the agent's own key.
  if (args.wallet) {
    const bound = await client.readContract({ address: registry, abi: POLICY_ABI, functionName: 'agentWalletOf', args: [id] });
    if (getAddress(bound) === args.wallet) console.log(`${'setAgentWallet'.padEnd(15)} done`);
    else {
      await send('setAgentWallet', () =>
        wallet.writeContract({ address: registry, abi: POLICY_ABI, functionName: 'setAgentWallet', args: [id, args.wallet!] }),
      );
    }
  }

  // 3. Attestor.
  const currentAttestor = await client.readContract({ address: registry, abi: POLICY_ABI, functionName: 'attestorOf', args: [id] });
  if (currentAttestor !== zeroAddress && getAddress(currentAttestor) === attestor.address) console.log(`${'setAttestor'.padEnd(15)} done`);
  else {
    await send('setAttestor', () =>
      wallet.writeContract({ address: registry, abi: POLICY_ABI, functionName: 'setAttestor', args: [id, attestor.address] }),
    );
  }

  // 4. Policy.
  const [anchoredHash, anchoredVersion] = await client.readContract({ address: registry, abi: POLICY_ABI, functionName: 'activePolicy', args: [id] });
  let anchorTx: Hex | undefined;
  if (anchoredHash === policy.policyHash && anchoredVersion === policy.version) {
    console.log(`${'anchorPolicy'.padEnd(15)} done (v${anchoredVersion})`);
  } else if (anchoredVersion >= policy.version) {
    throw new Error(
      `The chain has v${anchoredVersion} ${anchoredHash}; the store's active policy is v${policy.version} ${policy.policyHash}. ` +
        'Versions only go up on-chain: the owner has to publish a newer version.',
    );
  } else {
    const receipt = await send('anchorPolicy', () =>
      wallet.writeContract({ address: registry, abi: POLICY_ABI, functionName: 'anchorPolicy', args: [id, policy.version, policy.policyHash] }),
    );
    anchorTx = receipt?.transactionHash;
  }

  if (!args.execute) {
    console.log(`${'store'.padEnd(15)} would write the token id and the anchor transaction`);
    return;
  }

  const [finalHash, finalVersion] = await client.readContract({ address: registry, abi: POLICY_ABI, functionName: 'activePolicy', args: [id] });
  if (finalHash !== policy.policyHash || finalVersion !== policy.version) {
    throw new Error(`Anchored policy does not match the store: ${finalHash} v${finalVersion}`);
  }

  // 5. Store last: from here authorize() starts anchoring this agent's decisions.
  if (anchorTx) await repo.activatePolicy(policy.id, anchorTx);
  if (agent.erc8004TokenId !== id.toString() || args.wallet) {
    await repo.updateAgent(agent.id, { erc8004TokenId: id.toString(), walletAddress: args.wallet });
  }
  console.log(`\n${agent.id} is ERC-8004 #${id}; policy v${policy.version} anchored and stored.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
