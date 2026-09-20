/**
 * How many decisions may be anchored, and on whose account.
 *
 * `/api/agents/:id/authorize` is public on purpose, and every call it answers
 * is anchored with gas the attestation key pays for. Without a ceiling that is
 * an open tap: a loop of curl drains the key in minutes, and from then on
 * nobody's decisions reach the chain -- including the ones that matter.
 *
 * The budget only ever limits the *anchor*. The decision is still computed,
 * signed, stored and returned; an over-budget one is recorded as SKIPPED, which
 * the UI and the proof already report as "not on-chain". Spending less gas must
 * never become a way to make the policy engine say no, or say nothing.
 *
 * Two ceilings, because they fail differently. Per caller, so one noisy client
 * exhausts its own allowance and not everyone's. Global, per hour and per day,
 * so many callers together still cannot outspend the balance.
 *
 * In memory, like the rate limiter: one process serves this deployment, and a
 * restart forgiving the counters is harmless.
 */

export interface AnchorBudgetLimits {
  perCaller: number;
  perCallerWindowMs: number;
  perHour: number;
  perDay: number;
}

export type AnchorSlot = { ok: true } | { ok: false; reason: 'CALLER' | 'HOUR' | 'DAY' };

const HOUR = 3_600_000;
const DAY = 86_400_000;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function anchorBudgetLimits(): AnchorBudgetLimits {
  return {
    // A guided demo run anchors fewer than ten decisions.
    perCaller: envInt('ANCHOR_MAX_PER_CALLER', 25),
    perCallerWindowMs: 10 * 60_000,
    perHour: envInt('ANCHOR_MAX_PER_HOUR', 120),
    perDay: envInt('ANCHOR_MAX_PER_DAY', 400),
  };
}

export function createAnchorBudget(limits: () => AnchorBudgetLimits = anchorBudgetLimits) {
  const callers = new Map<string, number[]>();
  let spent: number[] = [];

  return {
    /** Claim one anchor. Counted only when granted. */
    take(caller: string, now: number = Date.now()): AnchorSlot {
      const l = limits();
      spent = spent.filter((t) => now - t < DAY);
      const mine = (callers.get(caller) ?? []).filter((t) => now - t < l.perCallerWindowMs);

      let refusal: AnchorSlot | null = null;
      if (spent.length >= l.perDay) refusal = { ok: false, reason: 'DAY' };
      else if (spent.filter((t) => now - t < HOUR).length >= l.perHour) refusal = { ok: false, reason: 'HOUR' };
      else if (mine.length >= l.perCaller) refusal = { ok: false, reason: 'CALLER' };

      if (refusal) {
        if (mine.length > 0) callers.set(caller, mine);
        else callers.delete(caller);
        return refusal;
      }

      spent.push(now);
      mine.push(now);
      callers.set(caller, mine);
      // Callers are unauthenticated strings; do not let the map grow without end.
      if (callers.size > 5_000) {
        for (const [key, times] of callers) {
          if (times.every((t) => now - t >= l.perCallerWindowMs)) callers.delete(key);
        }
      }
      return { ok: true };
    },

    usage(now: number = Date.now()) {
      const l = limits();
      const day = spent.filter((t) => now - t < DAY);
      return {
        lastHour: day.filter((t) => now - t < HOUR).length,
        lastDay: day.length,
        perHour: l.perHour,
        perDay: l.perDay,
      };
    },
  };
}

export const anchorBudget = createAnchorBudget();

/**
 * Who is asking, as far as the budget cares.
 *
 * Cloudflare sets `cf-connecting-ip` and the origin listens on loopback only,
 * so the header cannot be supplied by the client. Without a proxy in front
 * there is no trustworthy address, and everyone shares one allowance.
 */
export function callerKey(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'direct'
  );
}
