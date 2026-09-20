import Link from 'next/link';
import { ArrowLeft, ShieldQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-72" />
      <main className="relative flex flex-1 items-center justify-center px-6">
        <div className="max-w-md text-center">
          <ShieldQuestion className="mx-auto h-8 w-8 text-faint" />
          <h1 className="mt-5 text-[26px] font-semibold tracking-tight">Nothing here</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            That address does not match an agent, a policy or a proof in this deployment.
          </p>
          <Link
            href="/"
            className="mt-7 inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-ink transition-colors hover:border-line-strong"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Chancela
          </Link>
        </div>
      </main>
    </div>
  );
}
