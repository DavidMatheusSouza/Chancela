'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

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
};

/** Breadcrumb plus the palette trigger. Keeps the page header free for content. */
export function Topbar() {
  const pathname = usePathname();
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  const segments = pathname.split('/').filter(Boolean);

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-bg/80 px-6 backdrop-blur">
      <nav className="flex items-center gap-1.5 text-[13px]">
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

      <button
        onClick={() =>
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
          )
        }
        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] text-faint transition-colors hover:border-line-strong hover:text-muted"
      >
        <Search className="h-3.5 w-3.5" />
        Search
        <kbd className="mono rounded border border-line bg-raised px-1 py-px text-[10px]">
          {mac ? '⌘' : 'Ctrl'}K
        </kbd>
      </button>
    </header>
  );
}
