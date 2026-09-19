import { randomUUID } from 'node:crypto';
import { evaluate } from '@trustagent/policy-engine';
import {
  REASON_TEXT,
  lookupTool,
  type AgentRecord,
  type Hex,
  type PolicyDocument,
  type ReasonCode,
} from '@trustagent/shared';
import { keccak256, toHex } from 'viem';
import { signCapsule } from './attestation';
import { anchorDecision } from './chain';
import { lookupCounterparty } from './nansen';
import { getRepository } from './store';
import type { DecisionRow } from './repository';

export interface AuthorizeInput {
  agentId: string;
  action: string;
  parameters: Record<string, unknown>;
  environment?: string;
  requestId?: string;
  ai?: { provider: string; model: string; rawIntent: unknown };
}

export interface AuthorizeOutput {
  decisionId: string;
  auditId: string;
  decision: string;
  reasonCode: ReasonCode;
  reasonText: string;
  risk: string;
  riskFactors: unknown;
  policyId?: string;
  policyVersion: number;
  policyHash: Hex;
  intentHash: Hex;
  decisionHash: Hex;
  capsule: unknown;
  signature: string;
  attestationAddress: string;
  expiresAt: number;
  trace: unknown;
  anchorStatus: DecisionRow['anchorStatus'];
}

export class AuthorizeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** 4-byte selector of the action name, so the chain stores a fixed-width tag. */
export function actionSelector(action: string): Hex {
  return keccak256(toHex(action)).slice(0, 10) as Hex;
}

/**
 * The authorization path.
 *
 * Deliberate ordering: the decision is computed, signed, and persisted *before*
 * anything is told to the caller, and the on-chain anchor happens afterwards,
 * off the request path. A decision that exists only once the chain confirms it
 * would make Monad a availability dependency of the security layer, which is
 * backwards.
 */
export async function authorize(input: AuthorizeInput): Promise<AuthorizeOutput> {
  const repo = await getRepository();

  const agentRow = await repo.getAgent(input.agentId);
  if (!agentRow) throw new AuthorizeError(`Unknown agent ${input.agentId}`, 404);

  const policyRow = await repo.getActivePolicy(input.agentId);
  const policy: PolicyDocument | null = policyRow ? (policyRow.document as PolicyDocument) : null;

  const agent: AgentRecord = {
    id: agentRow.id,
    ownerAddress: agentRow.ownerAddress,
    status: agentRow.status,
    erc8004TokenId: agentRow.erc8004TokenId,
    walletAddress: agentRow.walletAddress,
  };

  // Counterparty intelligence is an *input* to risk, gathered before the
  // decision so the engine stays synchronous and pure.
  const counterparty =
    typeof input.parameters.recipientAddress === 'string'
      ? input.parameters.recipientAddress
      : undefined;
  const riskSignals = await lookupCounterparty(counterparty);

  const now = Math.floor(Date.now() / 1000);
  const dayKey = utcDayKey();
  const usage = await repo.usageFor(input.agentId, dayKey);
  const nonce = `${input.agentId}-${randomUUID()}`;

  const result = evaluate({
    agent,
    policy,
    policyId: policyRow?.id ?? 'none',
    action: input.action,
    parameters: input.parameters,
    riskSignals,
    usage,
    environment: input.environment ?? 'production',
    now,
    nonce,
  });

  const signed = await signCapsule(result.capsule);

  const decisionId = `dec_${randomUUID()}`;
  const auditId = `TA-AUDIT-${result.decisionHash.slice(2, 10).toUpperCase()}`;

  const row: DecisionRow = {
    id: decisionId,
    agentId: input.agentId,
    policyId: policyRow?.id,
    action: input.action,
    outcome: result.decision,
    risk: result.risk,
    reasonCode: result.reasonCode,
    reasonDetail: result.trace.at(-1)?.detail,
    policyVersion: result.policyVersion,
    policyHash: result.policyHash,
    intentHash: result.intentHash,
    decisionHash: result.decisionHash,
    nonce,
    capsule: result.capsule,
    signature: signed.signature,
    trace: result.trace,
    riskFactors: result.riskAssessment.factors,
    rawIntent: input.ai?.rawIntent,
    aiProvider: input.ai?.provider,
    aiModel: input.ai?.model,
    environment: input.environment ?? 'production',
    requestId: input.requestId,
    issuedAt: new Date(now * 1000).toISOString(),
    expiresAt: new Date(result.capsule.expiresAt * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    parameters: input.parameters,
    anchorStatus: 'PENDING',
    auditId,
  };

  await repo.recordDecision(row);

  // Fire-and-forget anchoring. Both allows and denies are written: a registry
  // that only proves the allows is marketing, not an audit trail.
  void anchorInBackground(row, agentRow.erc8004TokenId);

  return {
    decisionId,
    auditId,
    decision: result.decision,
    reasonCode: result.reasonCode,
    reasonText: REASON_TEXT[result.reasonCode],
    risk: result.risk,
    riskFactors: result.riskAssessment.factors,
    policyId: policyRow?.id,
    policyVersion: result.policyVersion,
    policyHash: result.policyHash,
    intentHash: result.intentHash,
    decisionHash: result.decisionHash,
    capsule: result.capsule,
    signature: signed.signature,
    attestationAddress: signed.attestationAddress,
    expiresAt: result.capsule.expiresAt,
    trace: result.trace,
    anchorStatus: 'PENDING',
  };
}

async function anchorInBackground(row: DecisionRow, tokenId: string | undefined): Promise<void> {
  const repo = await getRepository();
  if (!tokenId) {
    await repo.updateAnchor(row.id, { anchorStatus: 'SKIPPED' });
    return;
  }
  const result = await anchorDecision({
    agentTokenId: tokenId,
    decisionHash: row.decisionHash,
    intentHash: row.intentHash,
    actionSelector: actionSelector(row.action),
    decision: row.outcome,
    risk: row.risk,
    policyHash: row.policyHash,
  });
  await repo.updateAnchor(row.id, {
    anchorStatus: result.status,
    onchainTxHash: result.txHash,
    blockNumber: result.blockNumber,
  });
}

/** Human-facing label for an action, or the raw name when unregistered. */
export function actionLabel(action: string): string {
  return lookupTool(action)?.label ?? action;
}
