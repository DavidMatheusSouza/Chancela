'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/ui';

interface Status {
  reachable: boolean;
  blockNumber?: string;
  registryDeployed?: boolean;
  chain: { id: number; name: string };
}

/**
 * Chain health in the top bar.
 *
 * It polls `/api/network/status`, which reads the block number and checks that
 * the configured registry actually holds bytecode. The point is not decoration:
 * if the RPC goes down mid-demo, every proof link on the site is dead, and the
 * header should be the first thing to say so rather than the last.
 *
 * Polling stops while the tab is hidden, and a failed poll is shown as failed
 * -- a stale block number presented as current would be worse than none.
 */
export function SystemStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/network/status', { cache: 'no-store' });
        const body = await res.json();
        if (cancelled) return;
        setStatus(body);
        setFailed(!body?.reachable);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    void poll();
    const timer = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!status) return null;

  const ok = status.reachable && !failed;

  return (
    <div className="hidden items-center gap-3 text-[11.5px] lg:flex">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            ok ? 'bg-allow dot-live' : 'bg-deny',
          )}
        />
        <span className="text-muted">{status.chain.name}</span>
      </span>

      {ok && status.blockNumber ? (
        <span className="mono text-faint" title="Latest block seen by the RPC">
          #{status.blockNumber}
        </span>
      ) : (
        <span className="text-deny">RPC unreachable</span>
      )}

      {ok && status.registryDeployed === false ? (
        <span className="text-warn">registry missing</span>
      ) : null}
    </div>
  );
}
