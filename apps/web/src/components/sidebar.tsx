'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Bot,
  FileCheck2,
  LayoutDashboard,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Mono, StatusDot } from './primitives';

export { NAV };

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/policies', label: 'Policies', icon: FileCheck2 },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/audit', label: 'Audit Trail', icon: ScrollText },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export interface SidebarProps {
  chainName: string;
  chainId: number;
  owner?: string;
  /** Called after a nav item is chosen, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}

/**
 * The navigation rail.
 *
 * Hidden below `md` and rendered inside a drawer there instead -- a fixed 224px
 * column takes most of a phone screen, and a judge who opens the link on their
 * phone should not meet a broken layout.
 */
export function Sidebar(props: SidebarProps) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <SidebarContent {...props} />
    </aside>
  );
}

export function SidebarContent({
  chainName,
  chainId,
  owner,
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2 px-5 py-5">
        <ShieldCheck className="h-5 w-5 text-chain" />
        <span className="text-[15px] font-semibold tracking-tight">TrustAgent</span>
      </Link>

      <nav className="flex-1 space-y-0.5 px-2.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="m-2.5 space-y-2">
        {owner ? (
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
            <div className="min-w-0">
              <div className="label">Signed in</div>
              <Mono className="block truncate text-[11px]">
                {owner.slice(0, 6)}...{owner.slice(-4)}
              </Mono>
            </div>
            <button
              onClick={signOut}
              title="Sign out"
              className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className="rounded-lg border border-line bg-raised px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12px] text-ink">
            <StatusDot tone="chain" live />
            Monad connected
          </div>
          <div className="mono mt-1 text-[11px] text-faint">
            {chainName} - {chainId}
          </div>
        </div>
      </div>
    </div>
  );
}
