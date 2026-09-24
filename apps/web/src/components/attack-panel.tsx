'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert, Zap } from 'lucide-react';
import { cn } from '@/lib/ui';

interface AttackOption {
  id: string;
  prompt: string;
  action: string;
}

interface Result {
  attack: string;
  action: string;
  decision: string;
  reasonText: string;
  risk: string;
  auditId: string;
  breaker: { tripped: boolean; count: number; threshold: number; windowSeconds: number };
}

/**
 * Attack the live trading agent from the ledger itself.
 *
 * The point is that the reader does not have to take the ledger's word for
 * anything: they cause a decision, and watch it arrive in the list below with
 * its proof. Only an attack id is sent; what the agent asks for is fixed
 * server-side.
 */
export function AttackPanel({ attacks, agentName }: { attacks: AttackOption[]; agentName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function launch(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch('/api/live/attack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attack: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      setResult(data as Result);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card lit mt-8 p-5">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-deny" />
        <h2 className="text-[15px] font-semibold tracking-tight">Try to break it</h2>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        {agentName} is a trading agent allowed to place orders up to $500 and nothing else. Send it
        one of these injected instructions and watch its policy answer — the decision lands in the
        ledger below, anchored on Monad.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {attacks.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => launch(a.id)}
            disabled={busy !== null}
            className="lift flex h-full flex-col items-start rounded-lg border border-line bg-surface p-3.5 text-left transition-colors hover:border-deny/50 disabled:opacity-60"
          >
            <span className="text-[13px] leading-snug text-ink">“{a.prompt}”</span>
            <span className="mono mt-auto pt-3 text-[11px] text-faint">
              {busy === a.id ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> asking the policy…
                </span>
              ) : (
                `→ ${a.action}`
              )}
            </span>
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-[13px] text-warn">{error}</p>}

      {result && (
        <div
          role="status"
          className={cn(
            'animate-in fade-in-0 slide-in-from-bottom-2 mt-4 rounded-lg p-4 duration-300',
            result.decision === 'DENY' ? 'verdict-deny' : result.decision === 'ALLOW' ? 'verdict-allow' : 'verdict-approval',
          )}
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-deny" />
            <div className="min-w-0 space-y-1.5">
              <div className="text-sm font-semibold text-ink">
                {result.decision === 'DENY' ? 'Refused' : result.decision === 'ALLOW' ? 'Allowed' : 'Held for the owner'}
                <span className="mono ml-2 text-[12px] font-normal text-muted">{result.action}</span>
              </div>
              <p className="text-[13px] text-muted">{result.reasonText}</p>
              {result.breaker.tripped ? (
                <p className="text-[13px] text-deny">
                  That was {result.breaker.count} critical refusals in {result.breaker.windowSeconds}s — the
                  circuit breaker suspended the agent. It now refuses everything, even orders its policy
                  allows, until things are quiet for two minutes.
                </p>
              ) : (
                result.decision === 'DENY' && (
                  <p className="text-[12px] text-faint">
                    Circuit breaker: {result.breaker.count}/{result.breaker.threshold} critical refusals in{' '}
                    {result.breaker.windowSeconds}s.
                  </p>
                )
              )}
              <Link href={`/proof/${result.auditId}`} className="inline-block text-[12.5px] text-chain hover:underline">
                Open the proof →
              </Link>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
