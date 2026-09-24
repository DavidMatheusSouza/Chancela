import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';

/** The header the public, sessionless pages share with the landing page. */
export function PublicHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/" className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-chain" />
        <span className="font-semibold tracking-tight">Chancela</span>
      </Link>
      <nav className="flex items-center gap-1 sm:gap-2">
        <Link href="/live" className="rounded-lg px-3 py-1.5 text-sm text-ink transition-colors hover:text-chain">
          Live ledger
        </Link>
        <a href="/demo" className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink">
          Demo
        </a>
        <Link
          href="/login?next=/dashboard"
          className="lift inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        >
          Dashboard <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </nav>
    </header>
  );
}
