import type { DecisionRow } from './repository';

export interface TrustScoreBreakdown {
  score: number;
  factors: Array<{ label: string; points: number }>;
}

/**
 * Explainable trust score.
 *
 * Every point is attributable to a named factor, and the total is just their
 * sum -- no opaque weighting. It informs humans. It is never consulted by the
 * policy engine, because a score that can authorize is a score worth attacking.
 */
export function computeTrustScore(input: {
  hasVerifiedOwner: boolean;
  policyVersion: number;
  decisions: DecisionRow[];
}): TrustScoreBreakdown {
  const factors: Array<{ label: string; points: number }> = [];

  factors.push({
    label: input.hasVerifiedOwner ? 'Verified owner (ERC-8004)' : 'Unverified owner',
    points: input.hasVerifiedOwner ? 30 : 0,
  });

  // A policy that never changes is easier to reason about than one in flux.
  const stability = input.policyVersion <= 3 ? 20 : input.policyVersion <= 6 ? 12 : 6;
  factors.push({ label: `Policy stability (v${input.policyVersion})`, points: stability });

  const total = input.decisions.length;
  const allowed = input.decisions.filter((d) => d.outcome === 'ALLOW').length;
  const denied = input.decisions.filter((d) => d.outcome === 'DENY').length;
  const criticalDenied = input.decisions.filter(
    (d) => d.outcome === 'DENY' && d.risk === 'CRITICAL',
  ).length;

  if (total === 0) {
    factors.push({ label: 'No activity yet', points: 0 });
  } else {
    factors.push({
      label: `Successful actions (${allowed}/${total})`,
      points: Math.round((allowed / total) * 20),
    });

    const anchored = input.decisions.filter((d) => d.anchorStatus === 'CONFIRMED').length;
    factors.push({
      label: `Decisions anchored on Monad (${anchored}/${total})`,
      points: Math.round((anchored / total) * 22),
    });

    if (criticalDenied > 0) {
      // Repeatedly reaching for what it cannot have is the signal that matters:
      // a well-configured agent should rarely trip a CRITICAL denial.
      factors.push({
        label: `Attempted blocked critical actions (${criticalDenied})`,
        points: -Math.min(25, criticalDenied * 10),
      });
    } else if (denied > 0) {
      factors.push({ label: `Denied actions (${denied})`, points: -Math.min(8, denied * 2) });
    }
  }

  const score = Math.max(0, Math.min(100, factors.reduce((sum, f) => sum + f.points, 0)));
  return { score, factors };
}
