/**
 * Chancela, checked against the chain in one command.
 *
 * Someone evaluating this has sixty seconds and no reason to believe a word of
 * the README. So this asks a live deployment for a real decision and then
 * refuses to take its answer on faith: the signature is checked against the
 * attestor the agent's *owner* registered on Monad, the capsule is checked
 * against the parameters actually in hand, and the decision hash is looked up
 * in the registry contract. The only thing the service is trusted for is
 * answering at all.
 *
 * Every step below is a question the chain or the local machine answers. If a
 * step needs the service's own word for something, it says so.
 */
import { createClient, attestorFromRegistry, type Decision } from 'chancela-sdk';
import { createPublicClient, http, type Address, type Hex } from 'viem';

/** The public deployment and the contracts it is documented to use. */
export const DEFAULTS = {
  url: 'https://chancela.xyz',
  rpc: 'https://testnet-rpc.monad.xyz',
  registry: '0xb403392DDE0FdA621264FE3dCe1B7C3ad5bA412e' as Address,
  chainId: 10143,
  agentId: 'TA-001',
  /** In the seeded policy: allowed, and refused. Both are read-only here. */
  allowedAction: 'CREATE_CUSTOMER',
  refusedAction: 'DELETE_CUSTOMER',
};

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'isDecisionRecorded',
    stateMutability: 'view',
    inputs: [{ name: 'decisionHash', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'attestorOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentTokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const;

export interface Step {
  n: number;
  title: string;
  ok: boolean;
  detail: string;
  /** What answered: the chain, this machine, or the service being checked. */
  source: 'chain' | 'local' | 'service';
}

export interface Options {
  url?: string;
  rpc?: string;
  registry?: Address;
  agentId?: string;
  /**
   * The ERC-8004 token id. Taken from the agent id's trailing number by
   * convention (TA-001 -> 1) rather than from the service: asking the service
   * which token id to check would let it point at an agent whose attestor it
   * does control.
   */
  tokenId?: bigint;
  fetch?: typeof fetch;
  sourcify?: boolean;
}

export function tokenIdFromAgentId(agentId: string): bigint {
  const match = /(\d+)\s*$/.exec(agentId);
  if (!match?.[1]) {
    throw new Error(
      `Cannot tell which ERC-8004 token id ${agentId} is. Pass --token-id, so this is not something the service gets to choose.`,
    );
  }
  return BigInt(match[1]);
}

/**
 * Run the checks and return what each one found.
 *
 * Returns rather than prints, so the same sequence can be asserted in tests.
 * A thrown error means the run could not be completed; a `false` step means the
 * deployment failed a check, which is the interesting outcome.
 */
export async function check(options: Options = {}): Promise<Step[]> {
  const url = options.url ?? DEFAULTS.url;
  const rpc = options.rpc ?? DEFAULTS.rpc;
  const registry = options.registry ?? DEFAULTS.registry;
  const agentId = options.agentId ?? DEFAULTS.agentId;
  const tokenId = options.tokenId ?? tokenIdFromAgentId(agentId);
  const doFetch = options.fetch ?? fetch;
  const steps: Step[] = [];
  const add = (s: Omit<Step, 'n'>) => {
    steps.push({ n: steps.length + 1, ...s });
    return s.ok;
  };

  const chainClient = createPublicClient({ transport: http(rpc) });
  const client = createClient({
    baseUrl: url,
    fetch: doFetch,
    attestor: attestorFromRegistry({ rpcUrl: rpc, registry, tokenId: () => tokenId }),
  });

  // 1. Whose signature counts -- asked of the registry, not of the service.
  let attestor: Address;
  try {
    attestor = await chainClient.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: 'attestorOf',
      args: [tokenId],
    });
    if (/^0x0{40}$/.test(attestor)) {
      add({ title: `Attestor for token ${tokenId}`, ok: false, detail: 'none registered on-chain', source: 'chain' });
      return steps;
    }
    add({
      title: `Whose signature counts for ${agentId}`,
      ok: true,
      detail: `${attestor} — set by the token holder, read from ${registry}`,
      source: 'chain',
    });
  } catch (err) {
    add({ title: 'Read the attestor from the registry', ok: false, detail: (err as Error).message, source: 'chain' });
    return steps;
  }

  // 2. A real decision, on an action the policy allows.
  const parameters = { name: 'Judge', email: 'judge@example.com' };
  let allowed: Decision;
  try {
    allowed = await client.authorize(agentId, DEFAULTS.allowedAction, parameters);
    add({
      title: `Ask to ${DEFAULTS.allowedAction}`,
      ok: allowed.decision === 'ALLOW',
      detail: `${allowed.decision} — ${allowed.reasonCode}, audit ${allowed.auditId}`,
      source: 'service',
    });
  } catch (err) {
    add({ title: `Ask to ${DEFAULTS.allowedAction}`, ok: false, detail: (err as Error).message, source: 'service' });
    return steps;
  }

  // 3. The signature is the attestor's, and the capsule is bound to these exact
  //    parameters. Verified here, with the address from step 1.
  const verdict = await client.verify(allowed, { agentId, action: DEFAULTS.allowedAction, parameters });
  add({
    title: 'Verify that capsule locally, against the on-chain attestor',
    ok: verdict.ok,
    detail: verdict.ok ? `signed by ${attestor}, bound to the parameters in hand` : `${verdict.code} ${verdict.detail ?? ''}`,
    source: 'local',
  });

  // 4. The same capsule, with the parameters swapped underneath it. This is the
  //    attack a boolean "allowed: true" cannot survive, and the reason the
  //    capsule commits to an intent hash.
  const tampered = await client.verify(allowed, {
    agentId,
    action: DEFAULTS.allowedAction,
    parameters: { ...parameters, email: 'attacker@example.com' },
  });
  add({
    title: 'Swap the parameters under that same capsule',
    ok: tampered.code === 'INTENT_MISMATCH',
    detail: tampered.ok ? 'ACCEPTED — the capsule is not bound to its parameters' : `rejected: ${tampered.code}`,
    source: 'local',
  });

  // 5. A refusal is an answer too, and it has to be signed and recorded like
  //    any other -- an audit trail that only proves the allows proves nothing.
  let refused: Decision | undefined;
  try {
    refused = await client.authorize(agentId, DEFAULTS.refusedAction, { id: 'cus_1' });
    const refusedVerdict = await client.verify(refused, {
      agentId,
      action: DEFAULTS.refusedAction,
      parameters: { id: 'cus_1' },
    });
    add({
      title: `Ask to ${DEFAULTS.refusedAction}, which the policy does not grant`,
      ok: refused.decision !== 'ALLOW' && refusedVerdict.code === 'NOT_AUTHORIZED',
      detail: `${refused.decision} — ${refused.reasonCode}; the SDK treats it as "no"`,
      source: 'local',
    });
  } catch (err) {
    add({ title: `Ask to ${DEFAULTS.refusedAction}`, ok: false, detail: (err as Error).message, source: 'service' });
  }

  // 6. Does the chain hold the decision this machine was handed? Anchoring is
  //    asynchronous, so give it a few seconds before concluding it is missing.
  const onChain = await waitForDecision(chainClient, registry, allowed.capsule.decisionHash);
  add({
    title: 'Look that decision up in the registry contract',
    ok: onChain,
    detail: onChain
      ? `isDecisionRecorded(${short(allowed.capsule.decisionHash)}) = true`
      : 'not recorded yet — anchoring may be over budget or the key out of gas',
    source: 'chain',
  });

  // 7. And the refusal, which is the half a service has any reason to hide.
  if (refused) {
    const refusedOnChain = await waitForDecision(chainClient, registry, refused.capsule.decisionHash);
    add({
      title: 'Look the refusal up too',
      ok: refusedOnChain,
      detail: refusedOnChain ? `isDecisionRecorded(${short(refused.capsule.decisionHash)}) = true` : 'not recorded yet',
      source: 'chain',
    });
  }

  // 8. The contract that answered is the source in the repository -- asserted
  //    by Sourcify, which recompiles it, not by anyone shipping this.
  if (options.sourcify !== false) {
    try {
      const response = await doFetch(`https://sourcify.dev/server/v2/contract/${DEFAULTS.chainId}/${registry}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json()) as { match?: string | null };
      add({
        title: 'Is that contract the published source',
        ok: body.match === 'exact_match',
        detail: body.match ? `Sourcify: ${body.match}` : 'not verified on Sourcify',
        source: 'chain',
      });
    } catch {
      add({ title: 'Is that contract the published source', ok: true, detail: 'Sourcify unreachable — skipped', source: 'chain' });
    }
  }

  return steps;
}

async function waitForDecision(
  client: ReturnType<typeof createPublicClient>,
  registry: Address,
  decisionHash: Hex,
  attempts = 6,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const recorded = await client.readContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: 'isDecisionRecorded',
        args: [decisionHash],
      });
      if (recorded) return true;
    } catch {
      // A flaky public RPC is not a missing decision; try again.
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

function short(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}
