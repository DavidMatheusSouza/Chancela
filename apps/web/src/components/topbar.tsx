'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { SidebarContent, type SidebarProps } from './sidebar';
import { SystemStatus } from './system-status';

const TITLES: Record<string, string> = {
  dashboard: 'Overview',
  agents: 'Agents',
  policies: 'Policies',
  activity: 'Trust activity',
  audit: 'Audit trail',
  integrations: 'Integrations',
  settings: 'Settings',
  console: 'Console',
  policy: 'Policy',
  trust: 'Trust',
  demo: 'Demo Mode',
};

/**
 * Breadcrumb, the palette trigger, and on phones the navigation drawer.
 *
 * The rail is hidden below `md`, so without this there is no way to move
 * between screens on a phone at all.
 */
export function Topbar({ nav }: { nav: SidebarProps }) {
  const pathname = usePathname();
  const [mac, setMac] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  const segments = pathname.split('/').filter(Boolean);

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              aria-label="Open navigation"
              className="-ml-1 rounded-md p-1.5 text-muted transition-colors hover:bg-raised hover:text-ink md:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-60 border-line bg-surface p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-full flex-col">
              <SidebarContent {...nav} onNavigate={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

      <nav className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[13px]">
        {segments.map((segment, i) => {
          const href = `/${segments.slice(0, i + 1).join('/')}`;
          const last = i === segments.length - 1;
          const label = TITLES[segment] ?? segment;
          return (
            <span key={href} className="flex items-center gap-1.5">
              {i > 0 ? <span className="text-faint">/</span> : null}
              {last ? (
                <span className="text-ink">{label}</span>
              ) : (
                <Link href={href} className="text-muted transition-colors hover:text-ink">
                  {label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
      </div>

      <div className="flex shrink-0 items-center gap-3">
      <SystemStatus />

      <button
        onClick={() =>
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
          )
        }
        className="flex shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] text-faint transition-colors hover:border-line-strong hover:text-muted"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="mono hidden rounded border border-line bg-raised px-1 py-px text-[10px] sm:inline">
          {mac ? '⌘' : 'Ctrl'}K
        </kbd>
      </button>
      </div>
    </header>
  );
}
