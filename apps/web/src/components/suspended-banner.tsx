'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Power, ShieldAlert } from 'lucide-react';

/**
 * Shown on a suspended agent's passport.
 *
 * The breaker never reopens by itself, so there has to be an obvious place for
 * the owner to do it -- otherwise a tripped breaker is an outage with no door.
 */
export function SuspendedBanner({ agentId, name }: { agentId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reactivate() {
    setBusy(true);
    try {
      await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="verdict-deny flex flex-wrap items-center justify-between gap-3 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-deny" />
        <div>
          <div className="text-[14px] font-semibold text-deny">{name} is suspended</div>
          <p className="mt-0.5 text-[13px] text-deny/90">
            Repeated critical refusals tripped the circuit breaker. Every request is refused at the
            first gate, including actions the policy grants, until the owner reactivates it.
          </p>
        </div>
      </div>
      <button
        onClick={() => void reactivate()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
        Reactivate as owner
      </button>
    </div>
  );
}
