'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  RISK_LEVELS,
  TOOL_REGISTRY,
  hashPolicyDocument,
  type PolicyDocument,
} from '@chancela/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge, Label, Mono } from '@/components/primitives';
import { cn, RISK_STYLE } from '@/lib/ui';

/** Minor units -> a dollar string for the input, and back. */
const toDollars = (minor: number) => (minor / 100).toString();
const toMinor = (dollars: string) => Math.max(0, Math.round(Number(dollars || '0') * 100));

/**
 * Policy builder.
 *
 * Editing never mutates the active version -- saving mints the next one, which
 * is the same rule the registry enforces on-chain in `anchorPolicy()`. So the
 * form is explicit about what it is about to create, and the hash is recomputed
 * in the browser from the same `hashPolicyDocument()` the server and the
 * contract agree on. Toggle a permission and the hash moves: that is the whole
 * claim of the product, made visible before anything is written.
 */
export function PolicyBuilder({
  agentId,
  activeVersion,
  activeHash,
  document,
}: {
  agentId: string;
  activeVersion: number;
  activeHash: string;
  document: PolicyDocument;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(document.name);
  const [permissions, setPermissions] = useState<string[]>(document.permissions);
  const [maxTx, setMaxTx] = useState(toDollars(document.limits.maxTransactionValue));
  const [dailyTx, setDailyTx] = useState(String(document.limits.dailyTransactions));
  const [dailyCap, setDailyCap] = useState(toDollars(document.limits.dailyValueCap));
  const [stepUp, setStepUp] = useState<string>(document.stepUpThreshold);

  const nextVersion = activeVersion + 1;

  const draft = useMemo(
    () => ({
      name,
      permissions,
      limits: {
        maxTransactionValue: toMinor(maxTx),
        dailyTransactions: Math.max(0, Math.trunc(Number(dailyTx || '0'))),
        dailyValueCap: toMinor(dailyCap),
      },
      stepUpThreshold: stepUp,
      environment: document.environment,
    }),
    [name, permissions, maxTx, dailyTx, dailyCap, stepUp, document.environment],
  );

  // The same function the server and the contract agree on, run locally.
  const nextHash = useMemo(
    () =>
      hashPolicyDocument({
        agentId,
        version: nextVersion,
        permissions: draft.permissions,
        limits: draft.limits as unknown as Record<string, number>,
        stepUpThreshold: draft.stepUpThreshold,
        environment: draft.environment as unknown as Record<string, unknown>,
      }),
    [agentId, nextVersion, draft],
  );

  const dirty =
    name !== document.name ||
    stepUp !== document.stepUpThreshold ||
    draft.limits.maxTransactionValue !== document.limits.maxTransactionValue ||
    draft.limits.dailyTransactions !== document.limits.dailyTransactions ||
    draft.limits.dailyValueCap !== document.limits.dailyValueCap ||
    permissions.length !== document.permissions.length ||
    permissions.some((p) => !document.permissions.includes(p));

  function toggle(code: string, on: boolean) {
    setPermissions((prev) => (on ? [...new Set([...prev, code])] : prev.filter((p) => p !== code)));
  }

  function reset() {
    setName(document.name);
    setPermissions(document.permissions);
    setMaxTx(toDollars(document.limits.maxTransactionValue));
    setDailyTx(String(document.limits.dailyTransactions));
    setDailyCap(toDollars(document.limits.dailyValueCap));
    setStepUp(document.stepUpThreshold);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/policies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'Policy was refused');
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || pending;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Policy name</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13.5px] outline-none focus:border-chain/50"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Step up to owner approval at</Label>
          <select
            value={stepUp}
            onChange={(e) => setStepUp(e.target.value)}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13.5px] outline-none focus:border-chain/50"
          >
            {RISK_LEVELS.map((r) => (
              <option key={r} value={r}>
                {r} and above
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t border-line pt-5">
        <div className="flex items-center justify-between">
          <Label>Permissions</Label>
          <Mono className="text-faint">
            {permissions.length} granted / {PERMISSIONS.length - permissions.length} blocked
          </Mono>
        </div>
        <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
          {PERMISSIONS.map((code) => {
            const on = permissions.includes(code);
            const tool = TOOL_REGISTRY.find((t) => t.requiredPermission === code);
            return (
              <li
                key={code}
                className={cn(
                  'flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-[13px] transition-colors',
                  on ? 'border-allow/30 bg-allow/[0.05]' : 'border-line',
                )}
              >
                <Checkbox
                  id={`perm-${code}`}
                  checked={on}
                  onCheckedChange={(v) => toggle(code, v === true)}
                  className={on ? 'border-allow/60 data-[state=checked]:bg-allow/80' : undefined}
                />
                <label
                  htmlFor={`perm-${code}`}
                  className={cn('cursor-pointer select-none', on ? 'text-ink' : 'text-faint')}
                >
                  {PERMISSION_LABELS[code]}
                </label>
                {tool ? (
                  <span className={cn('ml-auto rounded border px-1.5 py-0.5 text-[10px]', RISK_STYLE[tool.risk])}>
                    {tool.risk}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Max transaction ($)</Label>
          <input
            inputMode="decimal"
            value={maxTx}
            onChange={(e) => setMaxTx(e.target.value)}
            className="mono w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-chain/50"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Daily transactions</Label>
          <input
            inputMode="numeric"
            value={dailyTx}
            onChange={(e) => setDailyTx(e.target.value)}
            className="mono w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-chain/50"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Daily value cap ($)</Label>
          <input
            inputMode="decimal"
            value={dailyCap}
            onChange={(e) => setDailyCap(e.target.value)}
            className="mono w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-chain/50"
          />
        </div>
      </div>

      <div className="space-y-2.5 border-t border-line pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Hash of the version this would create</Label>
          {dirty ? <Badge tone="warn">unsaved</Badge> : <Badge tone="neutral">unchanged</Badge>}
        </div>
        <Mono className={cn('block break-all text-[12px]', dirty ? 'text-chain' : 'text-faint')}>
          {nextHash}
        </Mono>
        <p className="text-[12px] leading-relaxed text-faint">
          Recomputed in your browser with the same <Mono>hashPolicyDocument()</Mono> the server and
          the registry use. Saving mints <Mono className="text-ink">v{nextVersion}</Mono> and leaves
          v{activeVersion} (<Mono>{activeHash.slice(0, 10)}…</Mono>) untouched, so decisions already
          taken under it stay explainable.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-deny/40 bg-deny/[0.06] p-3 text-[13px] text-deny">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-line pt-5">
        <button
          onClick={() => void save()}
          disabled={!dirty || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {busy ? 'Saving' : `Publish v${nextVersion}`}
        </button>
        <button
          onClick={reset}
          disabled={!dirty || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[13px] text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Discard
        </button>
      </div>
    </div>
  );
}
