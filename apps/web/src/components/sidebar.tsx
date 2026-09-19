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
import { cn } from '@/lib/ui';
import { StatusDot } from './primitives';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/policies', label: 'Policies', icon: FileCheck2 },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/audit', label: 'Audit Trail', icon: ScrollText },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ chainName, chainId }: { chainName: string; chainId: number }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
      <Link href="/" className="flex items-center gap-2 px-5 py-5">
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

      <div className="m-2.5 rounded-lg border border-line bg-raised px-3 py-2.5">
        <div className="flex items-center gap-2 text-[12px] text-ink">
          <StatusDot tone="chain" live />
          Monad connected
        </div>
        <div className="mt-1 mono text-[11px] text-faint">
          {chainName} - {chainId}
        </div>
      </div>
    </aside>
  );
}
