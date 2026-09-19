import { cn } from '@/lib/ui';
import type { ReactNode } from 'react';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('card p-5', className)}>{children}</div>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('label', className)}>{children}</div>;
}

export function Field({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className={cn('text-sm text-ink', mono && 'mono text-[13px]')}>{value}</div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'allow' | 'deny' | 'warn' | 'chain';
  className?: string;
}) {
  const tones = {
    neutral: 'border-line text-muted',
    allow: 'border-allow/50 text-allow',
    deny: 'border-deny/60 text-deny',
    warn: 'border-warn/60 text-warn',
    chain: 'border-chain/50 text-chain',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'allow', live = false }: { tone?: 'allow' | 'deny' | 'warn' | 'chain'; live?: boolean }) {
  const colors = { allow: 'bg-allow', deny: 'bg-deny', warn: 'bg-warn', chain: 'bg-chain' };
  return <span className={cn('inline-block h-1.5 w-1.5 rounded-full', colors[tone], live && 'dot-live')} />;
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'allow' | 'deny' | 'warn' | 'chain';
}) {
  const toneClass = tone ? { allow: 'text-allow', deny: 'text-deny', warn: 'text-warn', chain: 'text-chain' }[tone] : 'text-ink';
  return (
    <Card className="space-y-2">
      <Label>{label}</Label>
      <div className={cn('text-2xl font-semibold tabular-nums tracking-tight', toneClass)}>{value}</div>
      {hint ? <div className="text-xs text-faint">{hint}</div> : null}
    </Card>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line py-12 text-center">
      <div className="text-sm text-muted">{title}</div>
      {hint ? <div className="text-xs text-faint">{hint}</div> : null}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('mono text-[12.5px] text-muted', className)}>{children}</span>;
}
