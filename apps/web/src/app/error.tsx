'use client';

import { useEffect } from 'react';
import { RotateCcw, ShieldAlert } from 'lucide-react';

/**
 * Last-resort error screen.
 *
 * It deliberately shows the digest and not the message. A stack trace on a
 * public deployment is reconnaissance, and this product's whole argument is
 * that it does not leak what it does not need to. The digest is enough to find
 * the same error in the server logs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-deny" />
          <h1 className="mt-5 text-[26px] font-semibold tracking-tight">Something failed</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            The request did not complete. No authorization was granted -- this product fails
            closed, so an error is never an allow.
          </p>
          {error.digest ? (
            <p className="mono mt-4 text-[11.5px] text-faint">digest {error.digest}</p>
          ) : null}
          <button
            onClick={reset}
            className="mt-7 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-ink transition-colors hover:border-line-strong"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      </main>
    </div>
  );
}
