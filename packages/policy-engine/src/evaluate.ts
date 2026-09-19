import {
  TOOL_PARAMETER_SCHEMAS,
  hashDecision,
  hashIntent,
  hashPolicyDocument,
  lookupTool,
  type AgentRecord,
  type AuthorizationCapsule,
  type DecisionOutcome,
  type Hex,
  type PolicyDocument,
  type ReasonCode,
  type RiskLevel,
  type RiskSignal,
} from '@trustagent/shared';
import { assessRisk, compareRisk, type RiskAssessment } from './risk';

/** Usage counters for the current UTC day. Supplied by the caller; never read here. */
export interface UsageWindow {
  transactionsToday: number;
  valueMovedToday: number;
}

export interface EvaluateInput {
  agent: AgentRecord;
  policy: PolicyDocument | null;
  policyId: string;
  action: string;
  parameters: Record<string, unknown>;
  riskSignals?: readonly RiskSignal[];
  usage?: UsageWindow;
  environment?: string;
  /** Epoch seconds. Injected so the engine is fully deterministic under test. */
  now: number;
  /** Unique per request. The caller generates it; the engine only records it. */
  nonce: string;
  /** Capsule lifetime in seconds. Short on purpose. */
  ttlSeconds?: number;
}

export interface EvaluateResult {
  decision: DecisionOutcome;
  reasonCode: ReasonCode;
  risk: RiskLevel;
  riskAssessment: RiskAssessment;
  policyHash: Hex;
  policyVersion: number;
  intentHash: Hex;
  decisionHash: Hex;
  capsule: AuthorizationCapsule;
  /** Ordered trace of every pipeline step. Rendered in the UI and the audit log. */
  trace: Array<{ step: number; name: string; passed: boolean; detail?: string }>;
}

const DEFAULT_TTL_SECONDS = 60;
const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex;

/**
 * The authorization decision.
 *
 * Properties this function guarantees, each covered by a test:
 *  - it never throws, for any input whatsoever;
 *  - it performs no I/O and reads no ambient state (time is injected);
 *  - identical input produces an identical decisionHash;
 *  - there is no path to ALLOW that skips steps 1..9;
 *  - the default at the bottom of the pipeline is DENY.
 */
export function evaluate(input: EvaluateInput): EvaluateResult {
  try {
    return run(input);
  } catch (err) {
    // A crash must not become an authorization. Fail closed, always.
    return fail(input, 'MALFORMED_INPUT', [
      {
        step: 0,
        name: 'input-integrity',
        passed: false,
        detail: err instanceof Error ? err.message : 'unknown error',
      },
    ]);
  }
}

function run(input: EvaluateInput): EvaluateResult {
  const trace: EvaluateResult['trace'] = [];
  const environment = input.environment ?? 'production';
  const usage = input.usage ?? { transactionsToday: 0, valueMovedToday: 0 };
  const riskSignals = input.riskSignals ?? [];

  // ---- Step 1: agent status -------------------------------------------------
  if (input.agent.status === 'REVOKED') {
    trace.push({ step: 1, name: 'agent-status', passed: false, detail: 'REVOKED' });
    return fail(input, 'AGENT_REVOKED', trace);
  }
  if (input.agent.status !== 'ACTIVE') {
    trace.push({ step: 1, name: 'agent-status', passed: false, detail: input.agent.status });
    return fail(input, 'AGENT_SUSPENDED', trace);
  }
  trace.push({ step: 1, name: 'agent-status', passed: true, detail: 'ACTIVE' });

  // ---- Step 2: policy is bound and live -------------------------------------
  const policy = input.policy;
  if (!policy) {
    trace.push({ step: 2, name: 'policy-bound', passed: false });
    return fail(input, 'POLICY_INACTIVE', trace);
  }
  if (policy.expiresAt !== undefined && policy.expiresAt <= input.now) {
    trace.push({ step: 2, name: 'policy-bound', passed: false, detail: 'expired' });
    return fail(input, 'POLICY_EXPIRED', trace, policy);
  }
  trace.push({ step: 2, name: 'policy-bound', passed: true, detail: `v${policy.version}` });

  // ---- Step 3: action exists in the Tool Registry ---------------------------
  const tool = lookupTool(input.action);
  if (!tool) {
    trace.push({ step: 3, name: 'tool-registry', passed: false, detail: input.action });
    return fail(input, 'UNKNOWN_ACTION', trace, policy);
  }
  if (!tool.enabled) {
    trace.push({ step: 3, name: 'tool-registry', passed: false, detail: 'disabled' });
    return fail(input, 'TOOL_DISABLED', trace, policy);
  }
  trace.push({ step: 3, name: 'tool-registry', passed: true, detail: tool.toolId });

  // ---- Step 4: permission granted by this policy ----------------------------
  // Deny by default: membership is required, absence is never permissive.
  if (!policy.permissions.includes(tool.requiredPermission)) {
    trace.push({
      step: 4,
      name: 'permission',
      passed: false,
      detail: `missing ${tool.requiredPermission}`,
    });
    return fail(input, 'PERMISSION_DENIED', trace, policy);
  }
  trace.push({ step: 4, name: 'permission', passed: true, detail: tool.requiredPermission });

  // ---- Step 5: parameters match the tool input schema -----------------------
  const paramSchema = TOOL_PARAMETER_SCHEMAS[tool.toolId];
  let parameters = input.parameters;
  if (paramSchema) {
    const parsed = paramSchema.safeParse(input.parameters);
    if (!parsed.success) {
      trace.push({
        step: 5,
        name: 'parameter-schema',
        passed: false,
        detail: parsed.error.issues[0]?.message ?? 'schema mismatch',
      });
      return fail(input, 'INVALID_PARAMETERS', trace, policy);
    }
    // Use the parsed value: unknown keys are already rejected by .strict(),
    // and defaults are materialised so the intent hash is stable.
    parameters = parsed.data as Record<string, unknown>;
  }
  trace.push({ step: 5, name: 'parameter-schema', passed: true });

  // ---- Step 6: explicit counterparty denylist -------------------------------
  const counterparty = extractCounterparty(parameters);
  const blocked = policy.environment.blockedCounterparties ?? [];
  if (counterparty && blocked.some((b) => b.toLowerCase() === counterparty.toLowerCase())) {
    trace.push({ step: 6, name: 'counterparty', passed: false, detail: counterparty });
    return fail(input, 'COUNTERPARTY_BLOCKED', trace, policy, parameters);
  }
  trace.push({ step: 6, name: 'counterparty', passed: true });

  // ---- Step 7: value and rate limits ----------------------------------------
  const amount = typeof parameters.amount === 'number' ? parameters.amount : 0;
  if (tool.movesValue) {
    if (amount > policy.limits.maxTransactionValue) {
      trace.push({
        step: 7,
        name: 'limits',
        passed: false,
        detail: `amount ${amount} > max ${policy.limits.maxTransactionValue}`,
      });
      return fail(input, 'LIMIT_EXCEEDED', trace, policy, parameters);
    }
    if (usage.transactionsToday >= policy.limits.dailyTransactions) {
      trace.push({
        step: 7,
        name: 'limits',
        passed: false,
        detail: `daily count ${usage.transactionsToday}/${policy.limits.dailyTransactions}`,
      });
      return fail(input, 'DAILY_LIMIT_EXCEEDED', trace, policy, parameters);
    }
    if (usage.valueMovedToday + amount > policy.limits.dailyValueCap) {
      trace.push({
        step: 7,
        name: 'limits',
        passed: false,
        detail: `daily value cap ${policy.limits.dailyValueCap}`,
      });
      return fail(input, 'DAILY_LIMIT_EXCEEDED', trace, policy, parameters);
    }
  }
  trace.push({ step: 7, name: 'limits', passed: true });

  // ---- Step 8: environment and time window ----------------------------------
  const allowedEnvs = policy.environment.allowedEnvironments;
  if (allowedEnvs && allowedEnvs.length > 0 && !allowedEnvs.includes(environment)) {
    trace.push({ step: 8, name: 'environment', passed: false, detail: environment });
    return fail(input, 'ENVIRONMENT_NOT_ALLOWED', trace, policy, parameters);
  }
  const window = policy.environment.timeWindowUtc;
  if (window) {
    const hour = utcHour(input.now);
    const inWindow =
      window.startHour < window.endHour
        ? hour >= window.startHour && hour < window.endHour
        : hour >= window.startHour || hour < window.endHour; // wraps midnight
    if (!inWindow) {
      trace.push({ step: 8, name: 'time-window', passed: false, detail: `hour ${hour}` });
      return fail(input, 'OUT_OF_TIME_WINDOW', trace, policy, parameters);
    }
  }
  trace.push({ step: 8, name: 'environment', passed: true, detail: environment });

  // ---- Step 9: risk assessment ----------------------------------------------
  const riskAssessment = assessRisk({
    action: tool.toolId,
    parameters,
    maxTransactionValue: policy.limits.maxTransactionValue,
    riskSignals,
  });
  trace.push({ step: 9, name: 'risk', passed: true, detail: riskAssessment.level });

  // ---- Step 10: step-up -- risk at/above threshold needs a human -------------
  if (compareRisk(riskAssessment.level, policy.stepUpThreshold) >= 0) {
    const reason: ReasonCode =
      riskAssessment.counterpartySeverity >= 50
        ? 'APPROVAL_REQUIRED_COUNTERPARTY'
        : amount > 0
          ? 'APPROVAL_REQUIRED_AMOUNT'
          : 'APPROVAL_REQUIRED_RISK';
    trace.push({
      step: 10,
      name: 'step-up',
      passed: false,
      detail: `${riskAssessment.level} >= ${policy.stepUpThreshold}`,
    });
    return build(input, 'REQUIRE_APPROVAL', reason, riskAssessment, trace, policy, parameters);
  }
  trace.push({ step: 10, name: 'step-up', passed: true });

  // ---- Step 11: allow -------------------------------------------------------
  // Reached only by passing every step above. There is no other return of ALLOW
  // anywhere in this file -- asserted by a test that greps the source.
  return build(input, 'ALLOW', 'OK', riskAssessment, trace, policy, parameters);
}

function extractCounterparty(parameters: Record<string, unknown>): string | undefined {
  const addr = parameters.recipientAddress;
  if (typeof addr === 'string' && addr.length > 0) return addr;
  const to = parameters.to;
  if (typeof to === 'string' && to.length > 0) return to;
  return undefined;
}

function utcHour(epochSeconds: number): number {
  return new Date(epochSeconds * 1000).getUTCHours();
}

/** Build a DENY result. Kept separate so every denial path looks identical. */
function fail(
  input: EvaluateInput,
  reasonCode: ReasonCode,
  trace: EvaluateResult['trace'],
  policy?: PolicyDocument,
  parameters?: Record<string, unknown>,
): EvaluateResult {
  const assessment: RiskAssessment = {
    level: reasonCodeRisk(reasonCode, input.action),
    factors: [{ label: 'Denied before risk assessment', effect: 'BASE' }],
    counterpartySeverity: 0,
  };
  return build(input, 'DENY', reasonCode, assessment, trace, policy, parameters);
}

/** Denials still carry a meaningful risk label so the audit trail stays sortable. */
function reasonCodeRisk(reasonCode: ReasonCode, action: string): RiskLevel {
  const tool = lookupTool(action);
  if (tool) return tool.risk;
  return reasonCode === 'UNKNOWN_ACTION' ? 'HIGH' : 'MEDIUM';
}

function build(
  input: EvaluateInput,
  decision: DecisionOutcome,
  reasonCode: ReasonCode,
  riskAssessment: RiskAssessment,
  trace: EvaluateResult['trace'],
  policy?: PolicyDocument,
  parameters?: Record<string, unknown>,
): EvaluateResult {
  const effectiveParams = parameters ?? input.parameters ?? {};
  const intentHash = safeHash(() =>
    hashIntent({
      agentId: input.agent.id,
      action: input.action,
      parameters: effectiveParams,
    }),
  );

  const policyHash = policy
    ? safeHash(() =>
        hashPolicyDocument({
          agentId: policy.agentId,
          version: policy.version,
          permissions: policy.permissions,
          limits: policy.limits as unknown as Record<string, number>,
          stepUpThreshold: policy.stepUpThreshold,
          environment: policy.environment as unknown as Record<string, unknown>,
        }),
      )
    : ZERO_HASH;

  const policyVersion = policy?.version ?? 0;
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const decisionHash = safeHash(() =>
    hashDecision({
      agentId: input.agent.id,
      action: input.action,
      decision,
      risk: riskAssessment.level,
      reasonCode,
      intentHash,
      policyHash,
      policyVersion,
      nonce: input.nonce,
      issuedAt: input.now,
    }),
  );

  const capsule: AuthorizationCapsule = {
    version: 1,
    agentId: input.agent.id,
    ownerAddress: input.agent.ownerAddress,
    action: input.action,
    intentHash,
    policyId: input.policyId,
    policyVersion,
    policyHash,
    decision,
    risk: riskAssessment.level,
    reasonCode,
    nonce: input.nonce,
    issuedAt: input.now,
    expiresAt: input.now + ttl,
    decisionHash,
  };

  return {
    decision,
    reasonCode,
    risk: riskAssessment.level,
    riskAssessment,
    policyHash,
    policyVersion,
    intentHash,
    decisionHash,
    capsule,
    trace,
  };
}

/** Hashing must never be the thing that throws out of evaluate(). */
function safeHash(fn: () => Hex): Hex {
  try {
    return fn();
  } catch {
    return ZERO_HASH;
  }
}
