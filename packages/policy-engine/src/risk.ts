import {
  RISK_ORDINAL,
  baselineRisk,
  type RiskLevel,
  type RiskSignal,
} from '@chancela/shared';

export interface RiskAssessment {
  level: RiskLevel;
  /** Ordered list of what moved the needle. Shown verbatim in the UI. */
  factors: Array<{ label: string; effect: 'BASE' | 'ESCALATE'; detail?: string }>;
  /** Highest counterparty severity seen, 0..100. */
  counterpartySeverity: number;
}

const ORDER: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function escalate(level: RiskLevel, steps: number): RiskLevel {
  const idx = Math.min(ORDER.length - 1, RISK_ORDINAL[level] + steps);
  return ORDER[idx] as RiskLevel;
}

export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return RISK_ORDINAL[a] - RISK_ORDINAL[b];
}

/**
 * Deterministic risk assessment.
 *
 * Starts from the tool's registry risk -- never from anything an LLM said --
 * and escalates on hard signals. It can only ever raise risk, never lower it:
 * there is no input that makes TRANSFER_FUNDS look safe.
 */
export function assessRisk(input: {
  action: string;
  parameters: Record<string, unknown>;
  maxTransactionValue: number;
  riskSignals: readonly RiskSignal[];
}): RiskAssessment {
  const factors: RiskAssessment['factors'] = [];

  const base = baselineRisk(input.action) ?? 'CRITICAL';
  factors.push({
    label: `Registry baseline for ${input.action}`,
    effect: 'BASE',
    detail: base,
  });

  let level = base;

  // Escalate on value relative to the policy ceiling.
  const amount = typeof input.parameters.amount === 'number' ? input.parameters.amount : 0;
  if (amount > 0 && input.maxTransactionValue > 0) {
    const ratio = amount / input.maxTransactionValue;
    if (ratio > 0.8) {
      level = escalate(level, 1);
      factors.push({
        label: 'Value is above 80% of the policy ceiling',
        effect: 'ESCALATE',
        detail: `${Math.round(ratio * 100)}% of limit`,
      });
    }
  }

  // Escalate on counterparty intelligence (Nansen labels, internal denylist).
  let counterpartySeverity = 0;
  for (const signal of input.riskSignals) {
    if (signal.severity > counterpartySeverity) counterpartySeverity = signal.severity;
  }
  if (counterpartySeverity >= 80) {
    level = escalate(level, 2);
    factors.push({
      label: 'Counterparty flagged as high risk',
      effect: 'ESCALATE',
      detail: `severity ${counterpartySeverity}`,
    });
  } else if (counterpartySeverity >= 50) {
    level = escalate(level, 1);
    factors.push({
      label: 'Counterparty carries risk labels',
      effect: 'ESCALATE',
      detail: `severity ${counterpartySeverity}`,
    });
  }

  return { level, factors, counterpartySeverity };
}
