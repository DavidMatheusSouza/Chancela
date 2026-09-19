import { TrustAgentPolicyRegistry } from 'generated';

/** uint8 -> label, matching the enums in TrustAgentPolicyRegistry.sol. */
const DECISION = ['DENY', 'ALLOW', 'REQUIRE_APPROVAL'] as const;
const RISK = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

TrustAgentPolicyRegistry.PolicyAnchored.handler(async ({ event, context }) => {
  const agentId = event.params.agentTokenId.toString();

  context.PolicyAnchor.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    agentTokenId: event.params.agentTokenId,
    version: BigInt(event.params.version),
    policyHash: event.params.policyHash,
    owner: event.params.owner,
    anchoredAt: event.params.anchoredAt,
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  });

  const existing = await context.Agent.get(agentId);
  context.Agent.set({
    id: agentId,
    suspended: existing?.suspended ?? false,
    attestor: existing?.attestor,
    currentPolicyHash: event.params.policyHash,
    currentPolicyVersion: BigInt(event.params.version),
    totalDecisions: existing?.totalDecisions ?? 0n,
    totalAllowed: existing?.totalAllowed ?? 0n,
    totalDenied: existing?.totalDenied ?? 0n,
    lastActivityAt: event.params.anchoredAt,
  });
});

TrustAgentPolicyRegistry.DecisionRecorded.handler(async ({ event, context }) => {
  const agentId = event.params.agentTokenId.toString();
  const decision = DECISION[Number(event.params.decision)] ?? 'DENY';
  const risk = RISK[Number(event.params.risk)] ?? 'CRITICAL';

  context.Decision.set({
    id: event.params.decisionHash,
    agentTokenId: event.params.agentTokenId,
    decisionHash: event.params.decisionHash,
    intentHash: event.params.intentHash,
    action: event.params.action,
    decision,
    risk,
    policyHash: event.params.policyHash,
    ts: event.params.recordedAt,
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  });

  // Denials are counted just as carefully as allows. An explorer that only
  // surfaces successes is not an audit trail.
  const existing = await context.Agent.get(agentId);
  context.Agent.set({
    id: agentId,
    suspended: existing?.suspended ?? false,
    attestor: existing?.attestor,
    currentPolicyHash: existing?.currentPolicyHash ?? event.params.policyHash,
    currentPolicyVersion: existing?.currentPolicyVersion ?? 0n,
    totalDecisions: (existing?.totalDecisions ?? 0n) + 1n,
    totalAllowed: (existing?.totalAllowed ?? 0n) + (decision === 'ALLOW' ? 1n : 0n),
    totalDenied: (existing?.totalDenied ?? 0n) + (decision === 'DENY' ? 1n : 0n),
    lastActivityAt: event.params.recordedAt,
  });
});

TrustAgentPolicyRegistry.AgentSuspended.handler(async ({ event, context }) => {
  const agentId = event.params.agentTokenId.toString();
  context.AgentStatusChange.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    agentTokenId: event.params.agentTokenId,
    suspended: true,
    reasonCode: event.params.reasonCode,
    ts: event.params.at,
    txHash: event.transaction.hash,
  });
  const existing = await context.Agent.get(agentId);
  if (existing) context.Agent.set({ ...existing, suspended: true });
});

TrustAgentPolicyRegistry.AgentReactivated.handler(async ({ event, context }) => {
  const agentId = event.params.agentTokenId.toString();
  context.AgentStatusChange.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    agentTokenId: event.params.agentTokenId,
    suspended: false,
    ts: event.params.at,
    txHash: event.transaction.hash,
  });
  const existing = await context.Agent.get(agentId);
  if (existing) context.Agent.set({ ...existing, suspended: false });
});

TrustAgentPolicyRegistry.AttestorSet.handler(async ({ event, context }) => {
  const agentId = event.params.agentTokenId.toString();
  const existing = await context.Agent.get(agentId);
  context.Agent.set({
    id: agentId,
    suspended: existing?.suspended ?? false,
    attestor: event.params.attestor,
    currentPolicyHash: existing?.currentPolicyHash,
    currentPolicyVersion: existing?.currentPolicyVersion,
    totalDecisions: existing?.totalDecisions ?? 0n,
    totalAllowed: existing?.totalAllowed ?? 0n,
    totalDenied: existing?.totalDenied ?? 0n,
    lastActivityAt: existing?.lastActivityAt,
  });
});
