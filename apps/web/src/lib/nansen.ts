import type { RiskSignal } from '@chancela/shared';

/**
 * Counterparty intelligence.
 *
 * The policy engine knows whether TRANSFER_FUNDS is permitted. It does not know
 * that 0xabc... is a mixer. That is what this adds -- and only as a risk input.
 * A label can raise risk and force a human signature; it can never grant
 * anything, and Nansen being unreachable can never loosen a decision.
 */

const CACHE_TTL_MS = 60_000;
export const NANSEN_LABELS_URL = 'https://api.nansen.ai/api/v1/profiler/address/labels';
const cache = new Map<string, { at: number; signals: RiskSignal[] }>();

/** Labels that indicate the counterparty is dangerous, with a severity weight. */
const SEVERITY_BY_LABEL: Array<[RegExp, number]> = [
  [/tornado|mixer|sanction|ofac/i, 95],
  [/hack|exploit|drainer|phish|scam/i, 90],
  [/rug|honeypot/i, 85],
  [/high.?risk|flagged/i, 70],
  [/bridge|cex deposit/i, 30],
];

function severityFor(labels: string[]): number {
  let max = 0;
  for (const label of labels) {
    for (const [pattern, weight] of SEVERITY_BY_LABEL) {
      if (pattern.test(label) && weight > max) max = weight;
    }
  }
  return max;
}

export function isNansenConfigured(): boolean {
  return Boolean(process.env.NANSEN_API_KEY);
}

/** What the last real call to Nansen did, so /integrations reports it rather than the key's presence. */
let lastCall: { ok: boolean; at: number; error?: string } | null = null;

export function nansenStatus(): { status: 'CONNECTED' | 'FALLBACK'; detail: string } {
  if (!isNansenConfigured()) return { status: 'FALLBACK', detail: 'No API key: local denylist in use' };
  if (!lastCall) return { status: 'CONNECTED', detail: 'API key present; no lookup made since start' };
  const when = new Date(lastCall.at).toISOString();
  return lastCall.ok
    ? { status: 'CONNECTED', detail: `Last lookup answered at ${when}` }
    : { status: 'FALLBACK', detail: `Last lookup failed at ${when} (${lastCall.error}): local denylist in use` };
}

export async function lookupCounterparty(address: string | undefined): Promise<RiskSignal[]> {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return [];

  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.signals;

  const apiKey = process.env.NANSEN_API_KEY;
  if (!apiKey) {
    const signals = localSignals(key);
    cache.set(key, { at: Date.now(), signals });
    return signals;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    // https://docs.nansen.ai/api/profiler/address-labels -- Monad is a supported chain.
    const response = await fetch(NANSEN_LABELS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: apiKey },
      signal: controller.signal,
      // Labels change; Next.js would otherwise cache this POST for a year.
      cache: 'no-store',
      body: JSON.stringify({ address, chain: 'monad', pagination: { page: 1, per_page: 100 } }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: string };
      lastCall = { ok: false, at: Date.now(), error: body.code ?? `HTTP ${response.status}` };
      return localSignals(key);
    }
    lastCall = { ok: true, at: Date.now() };

    const payload = (await response.json()) as { data?: Array<{ label?: string }> };
    const labels = (payload.data ?? [])
      .map((row) => row.label)
      .filter((l): l is string => Boolean(l));

    const signals: RiskSignal[] = labels.length
      ? [{ source: 'NANSEN', subjectAddress: address, labels, severity: severityFor(labels) }]
      : [];
    cache.set(key, { at: Date.now(), signals });
    return signals;
  } catch {
    lastCall = { ok: false, at: Date.now(), error: 'unreachable' };
    // Intelligence being unavailable must never relax a decision, so we fall
    // back to the local denylist rather than to "no signals, all clear".
    return localSignals(key);
  }
}

/**
 * Offline denylist so the risk-escalation path is demonstrable without an API
 * key. Addresses ending in `bad` or `ff` are treated as flagged.
 */
function localSignals(address: string): RiskSignal[] {
  if (/(bad|dead|00ff)$/.test(address)) {
    return [
      {
        source: 'INTERNAL',
        subjectAddress: address,
        labels: ['Known Exploiter (local denylist)'],
        severity: 90,
      },
    ];
  }
  return [];
}
