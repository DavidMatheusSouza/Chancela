import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('lit rounded-lg border border-line bg-surface p-5', className)}>{children}</div>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('label', className)}>{children}</div>;
}

export function Field({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className={cn('text-[13.5px] text-ink', mono && 'mono text-[12.5px]')}>{value}</div>
    </div>
  );
}

const BADGE_TONES = {
  neutral: 'border-line text-muted',
  allow: 'border-allow/45 text-allow bg-allow/[0.06]',
  deny: 'border-deny/55 text-deny bg-deny/[0.07]',
  warn: 'border-warn/55 text-warn bg-warn/[0.06]',
  chain: 'border-chain/45 text-chain bg-chain/[0.07]',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.05em]',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  tone = 'allow',
  live = false,
}: {
  tone?: 'allow' | 'deny' | 'warn' | 'chain';
  live?: boolean;
}) {
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
  const toneClass = tone
    ? { allow: 'text-allow', deny: 'text-deny', warn: 'text-warn', chain: 'text-chain' }[tone]
    : 'text-ink';
  return (
    <Card className="space-y-2 p-4">
      <Label>{label}</Label>
      <div className={cn('text-[26px] font-semibold leading-none tabular-nums tracking-tight', toneClass)}>
        {value}
      </div>
      {hint ? <div className="text-[11.5px] text-faint">{hint}</div> : null}
    </Card>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line py-14 text-center">
      <div className="text-[13.5px] text-muted">{title}</div>
      {hint ? <div className="text-[12px] text-faint">{hint}</div> : null}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('mono text-[12px] text-muted', className)}>{children}</span>;
}

/**
 * Decision pill.
 *
 * Carries a glyph as well as a colour so the allow/deny distinction survives
 * grayscale, colour-blindness and a compressed screen recording.
 */
export function DecisionPill({ decision }: { decision: string }) {
  const map: Record<string, { tone: keyof typeof BADGE_TONES; glyph: string }> = {
    ALLOW: { tone: 'allow', glyph: '✓' },
    DENY: { tone: 'deny', glyph: '✕' },
    REQUIRE_APPROVAL: { tone: 'warn', glyph: '⚑' },
  };
  const entry = map[decision] ?? { tone: 'neutral' as const, glyph: '?' };
  return (
    <Badge tone={entry.tone}>
      <span aria-hidden>{entry.glyph}</span>
      {decision === 'REQUIRE_APPROVAL' ? 'APPROVAL' : decision}
    </Badge>
  );
}

const RISK_TONES: Record<string, keyof typeof BADGE_TONES> = {
  LOW: 'neutral',
  MEDIUM: 'warn',
  HIGH: 'warn',
  CRITICAL: 'deny',
};

export function RiskPill({ risk }: { risk: string }) {
  return <Badge tone={RISK_TONES[risk] ?? 'neutral'}>{risk}</Badge>;
}
