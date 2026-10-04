/**
 * `npx chancela-check replay <id>` -- run one recorded decision again, here.
 *
 * The policy engine is a pure function: it reads its input and nothing else.
 * So a decision's inputs are enough for anyone to run the engine themselves,
 * and the result has to be the decision hash the attestor signed.
 *
 * What it is compared with matters more than the re-run. The expectations do
 * not come from the service: they are decoded from the anchoring transaction
 * on Monad. The registry refuses to record a decision whose policy hash is not
 * the policy the agent's owner anchored (`PolicyHashMismatch`), so a bundle
 * whose policy hashes to the recorded one is running the owner's policy, not
 * one the service made up afterwards.
 *
 * The engine is bundled into this file from the same source the service runs.
 */
import { replay as runEngine, type ReplayBundle } from '@chancela/policy-engine';
import { createPublicClient, decodeFunctionData, http, type Address, type Hex } from 'viem';
import type { Step } from './check';

const RECORD_DECISION_ABI = [
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
] as const;

/** The registry's `Decision` enum, in its order. */
const OUTCOMES = ['DENY', 'ALLOW', 'REQUIRE_APPROVAL'] as const;

export interface ReplayOptions {
  id: string;
  url: string;
  rpc: string;
  registry: Address;
  fetch?: typeof fetch;
  /** Test seam: what Monad says the anchoring transaction recorded. */
  readAnchor?: (txHash: Hex) => Promise<Anchor | null>;
}

/** What the anchoring transaction wrote, decoded from the calldata Monad executed. */
export interface Anchor {
  succeeded: boolean;
  to: string | null;
  blockNumber: bigint;
  agentTokenId: bigint;
  decisionHash: Hex;
  intentHash: Hex;
  policyHash: Hex;
  decision: number;
}

export interface ReplayReport {
  steps: Step[];
  /** The engine's pipeline as it ran here, for printing. */
  trace: Array<{ step: number; name: string; passed: boolean; detail?: string }>;
  outcome?: string;
  reasonCode?: string;
}

interface Served {
  auditId: string;
  agentId: string;
  decisionHash: Hex;
  intentHash: Hex;
  policyHash: Hex;
  bundle: ReplayBundle;
  anchor: { status: string; txHash: Hex | null };
}

export async function replayDecision(options: ReplayOptions): Promise<ReplayReport> {
  const doFetch = options.fetch ?? fetch;
  const steps: Step[] = [];
  const add = (s: Omit<Step, 'n'>) => {
    steps.push({ n: steps.length + 1, ...s });
    return s.ok;
  };

  // 1. The inputs. The one thing the service is trusted for is handing them
  //    over; whether they are the right ones is settled below, not here.
  let served: Served;
  try {
    const response = await doFetch(`${options.url}/api/proofs/${encodeURIComponent(options.id)}/replay`, {
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json()) as Served & { error?: { code?: string; message?: string } };
    if (!response.ok || !body.bundle) {
      add({
        title: `Fetch the inputs of ${options.id}`,
        ok: false,
        detail: body.error?.message ?? `the service answered ${response.status}`,
        source: 'service',
      });
      return { steps, trace: [] };
    }
    served = body;
    add({
      title: `Fetch the inputs of ${served.auditId}`,
      ok: true,
      detail: `${served.bundle.action} by ${served.agentId}, policy v${served.bundle.policy?.version ?? 0}, ${new Date(
        served.bundle.now * 1000,
      ).toISOString()}`,
      source: 'service',
    });
  } catch (err) {
    add({ title: `Fetch the inputs of ${options.id}`, ok: false, detail: (err as Error).message, source: 'service' });
    return { steps, trace: [] };
  }

  // 2. What Monad recorded. From here on the service's hashes are not used.
  let anchor: Anchor | null = null;
  if (!served.anchor.txHash) {
    add({
      title: 'Read what Monad recorded for it',
      ok: false,
      detail: `this decision was not anchored (${served.anchor.status}), so there is nothing on Monad to compare with`,
      source: 'chain',
    });
  } else {
    try {
      anchor = await (options.readAnchor ?? readAnchorFrom(options.rpc))(served.anchor.txHash);
    } catch (err) {
      add({ title: 'Read what Monad recorded for it', ok: false, detail: (err as Error).message, source: 'chain' });
    }
    if (anchor) {
      const toRegistry = anchor.to?.toLowerCase() === options.registry.toLowerCase();
      add({
        title: 'Read what Monad recorded for it',
        ok: anchor.succeeded && toRegistry,
        detail:
          anchor.succeeded && toRegistry
            ? `block ${anchor.blockNumber}: ${OUTCOMES[anchor.decision] ?? anchor.decision} for token ${anchor.agentTokenId}, decision ${short(anchor.decisionHash)}`
            : !toRegistry
              ? `transaction ${short(served.anchor.txHash)} is not a call to the registry ${options.registry}`
              : 'the anchoring transaction reverted',
        source: 'chain',
      });
      if (!anchor.succeeded || !toRegistry) anchor = null;
    }
  }

  // Compared with the chain where there is a chain record, and with the
  // service's own figures otherwise -- which the failed step above already
  // says is worth less.
  const expected = {
    decisionHash: anchor?.decisionHash ?? served.decisionHash,
    policyHash: anchor?.policyHash ?? served.policyHash,
    intentHash: anchor?.intentHash ?? served.intentHash,
  };
  const against = anchor ? 'Monad recorded' : 'the service reported';

  // 3-5. One run of the engine, read three ways.
  const verdict = runEngine(served.bundle, expected);
  const result = verdict.result;
  if (!result) {
    add({ title: 'Run the policy engine on those inputs', ok: false, detail: 'the inputs are not a bundle the engine can run', source: 'local' });
    return { steps, trace: [] };
  }

  add({
    title: 'Is that the policy the owner anchored',
    ok: same(result.policyHash, expected.policyHash),
    detail: same(result.policyHash, expected.policyHash)
      ? `the policy in the inputs hashes to ${short(result.policyHash)}, the policy hash ${against}`
      : `the policy in the inputs hashes to ${short(result.policyHash)}, but ${against} ${short(expected.policyHash)}`,
    source: 'local',
  });
  add({
    title: 'Are those the parameters that were decided on',
    ok: same(result.intentHash, expected.intentHash),
    detail: same(result.intentHash, expected.intentHash)
      ? `they hash to ${short(result.intentHash)}, the intent hash ${against}`
      : `they hash to ${short(result.intentHash)}, but ${against} ${short(expected.intentHash)}`,
    source: 'local',
  });

  const sameOutcome = !anchor || OUTCOMES[anchor.decision] === result.decision;
  add({
    title: 'Run the policy engine here',
    ok: same(result.decisionHash, expected.decisionHash) && sameOutcome,
    detail: same(result.decisionHash, expected.decisionHash)
      ? `${result.decision} — ${result.reasonCode}; decision hash ${short(result.decisionHash)}, the one ${against}`
      : `${result.decision} — ${result.reasonCode}; this machine gets ${short(result.decisionHash)}, but ${against} ${short(expected.decisionHash)}`,
    source: 'local',
  });

  return { steps, trace: result.trace, outcome: result.decision, reasonCode: result.reasonCode };
}

function readAnchorFrom(rpc: string): (txHash: Hex) => Promise<Anchor | null> {
  return async (txHash) => {
    const client = createPublicClient({ transport: http(rpc) });
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash }),
      client.getTransactionReceipt({ hash: txHash }),
    ]);
    const call = decodeFunctionData({ abi: RECORD_DECISION_ABI, data: tx.input });
    const d = call.args[0];
    return {
      succeeded: receipt.status === 'success',
      to: tx.to,
      blockNumber: receipt.blockNumber,
      agentTokenId: d.agentTokenId,
      decisionHash: d.decisionHash,
      intentHash: d.intentHash,
      policyHash: d.policyHash,
      decision: d.decision,
    };
  };
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function short(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}
