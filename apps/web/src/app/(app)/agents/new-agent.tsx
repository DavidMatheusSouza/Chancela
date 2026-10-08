'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { PERMISSION_LABELS, TOOL_REGISTRY, type Permission } from '@chancela/shared';
import { Card, Label } from '@/components/primitives';
import { cn, RISK_STYLE } from '@/lib/ui';

/**
 * Starting points, not policies: they pick permissions only. Every limit starts
 * at zero -- nothing that moves value is allowed until the owner sets one on the
 * next page, which is where the form sends them.
 */
const TEMPLATES: { id: string; label: string; hint: string; permissions: Permission[] }[] = [
  {
    id: 'trading',
    label: 'Trading agent',
    hint: 'Places orders, reads balances. Cannot move funds out.',
    permissions: ['READ_TREASURY', 'PLACE_ORDER'],
  },
  {
    id: 'funded',
    label: 'Funded-trader agent',
    hint: 'Buys evaluations and places orders. Cannot move funds out.',
    permissions: ['READ_TREASURY', 'PLACE_ORDER', 'BUY_ASSESSMENT'],
  },
  {
    id: 'support',
    label: 'Support agent',
    hint: 'Reads and updates customers, replies to them.',
    permissions: ['READ_CUSTOMERS', 'CREATE_CUSTOMER', 'UPDATE_CUSTOMER', 'SEND_MESSAGE'],
  },
  {
    id: 'treasury',
    label: 'Treasury agent',
    hint: 'Reads balances and pays, within limits you set.',
    permissions: ['READ_TREASURY', 'TRANSFER_FUNDS'],
  },
];

const risk = (p: Permission) => TOOL_REGISTRY.find((t) => t.requiredPermission === p)?.risk;

export function NewAgent({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [template, setTemplate] = useState(TEMPLATES[0]!);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          permissions: template.permissions,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      router.push(`/agents/${body.agent.id}/policy`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition-opacity hover:opacity-90"
      >
        <Plus className="h-3.5 w-3.5" /> New agent
      </button>
    );
  }

  return (
    <Card className="w-full space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">New agent</h2>
          <p className="mt-1 text-[13px] text-muted">
            It starts with a policy that grants these permissions and allows nothing that moves
            value. Set its limits on the next page.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-faint hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. MON market maker"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13.5px] outline-none focus:border-chain/50"
          />
        </div>
        <div className="space-y-1.5">
          <Label>What it does (optional)</Label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder="Shown on its passport"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13.5px] outline-none focus:border-chain/50"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Start from</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTemplate(t)}
              aria-pressed={template.id === t.id}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                template.id === t.id ? 'border-chain/50 bg-chain/[0.06]' : 'border-line hover:border-line-strong',
              )}
            >
              <div className="text-[13px] font-medium text-ink">{t.label}</div>
              <div className="mt-0.5 text-[12px] text-muted">{t.hint}</div>
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {template.permissions.map((p) => (
            <li key={p} className="flex items-center gap-1.5 rounded-md border border-allow/30 bg-allow/[0.05] px-2 py-1 text-[12px] text-ink">
              {PERMISSION_LABELS[p]}
              {risk(p) ? (
                <span className={cn('rounded border px-1 text-[10px]', RISK_STYLE[risk(p)!])}>{risk(p)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {error ? (
        <div className="rounded-lg border border-deny/40 bg-deny/[0.06] p-3 text-[13px] text-deny">{error}</div>
      ) : null}

      <div className="flex items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || name.trim().length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create and set limits
        </button>
        <span className="text-[12px] text-faint">
          To give it an ERC-8004 identity on Monad, see the{' '}
          <a
            href="https://github.com/DavidMatheusSouza/Chancela/tree/main/examples/trading-agent#5-your-own-agent-about-10-minutes-with-us"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:text-ink hover:underline"
          >
            integration guide
          </a>
          .
        </span>
      </div>
    </Card>
  );
}
