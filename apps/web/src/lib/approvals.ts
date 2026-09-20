import { getAddress } from 'viem';
import type { Hex } from '@chancela/shared';
import { authorize, type AuthorizeOutput } from './authorize';
import { onchainApprover, recordApprovalOnchain } from './chain';
import { isSharedDemoOwner } from './demo-signin';
import type { ApprovalRow, ApproverKeyRow, Repository } from './repository';
import {
  publicKeyFromSpki,
  fromBase64Url,
  toOnchainAssertion,
  verifyApproval,
  type AssertionPayload,
} from './webauthn-approval';

/**
 * Owner approvals of step-up decisions.
 *
 * REQUIRE_APPROVAL is the policy saying "inside the rules, but a human decides".
 * The human answers with a passkey: a WebAuthn assertion whose challenge is the
 * decision hash. That is checked here, the request is evaluated again with the
 * approval in hand, and the assertion is then handed to ChancelaApprovals, where
 * Monad checks it a second time. Nothing in this path can be produced by the
 * service alone -- it has no passkey.
 */

export class ApprovalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}

/** The relying party is the site's hostname; the origin is the site. Both from configuration. */
export function relyingParty(): { rpId: string; origins: string[] } {
  const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3080';
  const url = new URL(base);
  const origins = [url.origin];
  if (process.env.NODE_ENV !== 'production') origins.push('http://localhost:3080', 'http://localhost:3099');
  return { rpId: url.hostname, origins };
}

/**
 * Register the passkey an owner approves with.
 *
 * The shared demo owner is every visitor at once, so whoever registered first
 * would become the approver of the demo agents. It stays closed for that
 * address unless the operator opens it for a moment to enrol their own passkey.
 */
export async function registerApprover(
  repo: Repository,
  ownerAddress: string,
  input: { credentialId: string; publicKeySpki: string },
): Promise<ApproverKeyRow> {
  if (isSharedDemoOwner(ownerAddress) && process.env.ALLOW_DEMO_APPROVER_ENROLMENT !== 'true') {
    throw new ApprovalError(
      403,
      'SHARED_DEMO_ACCOUNT',
      'The shared demo account cannot enrol an approver: it would make one visitor the approver for everyone. Create your own account with a passkey to try approvals.',
    );
  }
  if (!input.credentialId || input.credentialId.length > 1024) {
    throw new ApprovalError(400, 'INVALID_CREDENTIAL', 'credentialId is required');
  }
  let key;
  try {
    key = publicKeyFromSpki(fromBase64Url(input.publicKeySpki));
  } catch {
    throw new ApprovalError(400, 'NOT_A_P256_KEY', 'The passkey must be an ES256 (P-256) credential.');
  }
  return repo.setApproverKey({
    ownerAddress: getAddress(ownerAddress),
    credentialId: input.credentialId,
    publicKeyX: key.x,
    publicKeyY: key.y,
    createdAt: new Date().toISOString(),
  });
}

/** Mark as expired anything past its deadline, so a list never shows a dead request as live. */
export async function settleExpiry(repo: Repository, approval: ApprovalRow): Promise<ApprovalRow> {
  if (approval.status === 'PENDING' && Date.parse(approval.expiresAt) <= Date.now()) {
    return (await repo.updateApproval(approval.id, { status: 'EXPIRED', resolvedAt: new Date().toISOString() })) ?? approval;
  }
  return approval;
}

export async function approve(
  repo: Repository,
  approvalId: string,
  ownerAddress: string,
  assertion: AssertionPayload,
): Promise<{ approval: ApprovalRow; decision: AuthorizeOutput }> {
  const found = await repo.getApproval(approvalId);
  if (!found) throw new ApprovalError(404, 'NOT_FOUND', 'Unknown approval request');
  const approval = await settleExpiry(repo, found);
  if (approval.status === 'EXPIRED') throw new ApprovalError(410, 'EXPIRED', 'This approval request has expired.');
  if (approval.status !== 'PENDING') throw new ApprovalError(409, 'ALREADY_RESOLVED', 'This request was already approved.');

  const stepUp = await repo.getDecision(approval.decisionId);
  if (!stepUp) throw new ApprovalError(404, 'NOT_FOUND', 'The decision behind this request no longer exists');
  const agent = await repo.getAgent(stepUp.agentId);
  if (!agent) throw new ApprovalError(404, 'NOT_FOUND', `Unknown agent ${stepUp.agentId}`);
  if (getAddress(agent.ownerAddress) !== getAddress(ownerAddress)) {
    throw new ApprovalError(403, 'NOT_THE_OWNER', 'Only the owner of this agent may approve for it.');
  }

  const key = await repo.getApproverKey(agent.ownerAddress);
  if (!key) throw new ApprovalError(412, 'NO_APPROVER', 'Enrol an approver passkey first.');

  const verdict = verifyApproval({
    assertion,
    decisionHash: stepUp.decisionHash,
    publicKey: { x: key.publicKeyX, y: key.publicKeyY },
    credentialId: key.credentialId,
    ...relyingParty(),
  });
  if (!verdict.ok) throw new ApprovalError(403, `APPROVAL_${verdict.code}`, 'The passkey approval did not verify.');

  // Evaluate the same request again, now with the approval. Everything but the
  // step-up is judged afresh, so the answer can still be no.
  const decision = await authorize({
    agentId: stepUp.agentId,
    action: stepUp.action,
    parameters: stepUp.parameters,
    environment: stepUp.environment,
    requestId: stepUp.requestId,
    approval: { stepUpDecisionHash: stepUp.decisionHash as Hex },
  });
  if (decision.decision !== 'ALLOW') {
    throw new ApprovalError(
      409,
      'NO_LONGER_ALLOWED',
      `Approved, but the request is no longer permitted: ${decision.reasonText} (${decision.reasonCode}).`,
    );
  }

  const onchainReady = Boolean(agent.erc8004TokenId);
  const resolved =
    (await repo.updateApproval(approval.id, {
      status: 'APPROVED',
      resolvedAt: new Date().toISOString(),
      approvedDecisionId: decision.decisionId,
      assertion,
      onchainStatus: onchainReady ? 'PENDING' : 'SKIPPED',
      onchainError: onchainReady ? undefined : 'agent has no on-chain identity',
    })) ?? approval;

  if (onchainReady) {
    void recordOnchain(repo, resolved.id, agent.erc8004TokenId!, stepUp.decisionHash as Hex, key, assertion);
  }
  return { approval: resolved, decision };
}

async function recordOnchain(
  repo: Repository,
  approvalId: string,
  tokenId: string,
  decisionHash: Hex,
  key: ApproverKeyRow,
  assertion: AssertionPayload,
): Promise<void> {
  // The contract checks against the key the on-chain owner registered. If that
  // is not this key yet, sending would only buy a revert.
  const registered = await onchainApprover(tokenId);
  if (!registered || registered.x.toLowerCase() !== key.publicKeyX.toLowerCase() || registered.y.toLowerCase() !== key.publicKeyY.toLowerCase()) {
    await repo.updateApproval(approvalId, {
      onchainStatus: 'SKIPPED',
      onchainError: 'this approver key is not registered on-chain yet (scripts/set-approver.ts)',
    });
    return;
  }
  const result = await recordApprovalOnchain({
    agentTokenId: tokenId,
    decisionHash,
    assertion: toOnchainAssertion(assertion),
  });
  await repo.updateApproval(approvalId, {
    onchainStatus: result.status,
    onchainTxHash: result.txHash,
    onchainError: result.error,
  });
}
