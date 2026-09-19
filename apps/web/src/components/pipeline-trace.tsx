'use client';

import { Check, X } from 'lucide-react';
import { cn } from '@/lib/ui';

export interface TraceStep {
  step: number;
  name: string;
  passed: boolean;
  detail?: string;
}

/**
 * The authorization pipeline, as it actually ran.
 *
 * The policy engine has always emitted an ordered trace of every gate it
 * passed through; nothing rendered it. That made the product's central claim
 * -- that a deterministic pipeline decides, not the model -- something a
 * visitor had to take on faith.
 *
 * These are real recorded steps, not a progress animation. The engine
 * short-circuits on the first failure, so a DENY shows the gates it cleared
 * and the one that stopped it, which is exactly the question a person asks
 * when something is refused. Steps reveal in sequence only so the order is
 * legible; the outcome was decided before any of this rendered.
 */

const LABELS: Record<string, string> = {
  'agent-status': 'Agent status',
  'policy-bound': 'Policy bound',
  'tool-registry': 'Tool registry',
  permission: 'Permission',
  'parameter-schema': 'Parameter schema',
  'input-integrity': 'Input integrity',
  limits: 'Limits',
  'time-window': 'Time window',
  environment: 'Environment',
  counterparty: 'Counterparty',
  risk: 'Risk',
  'step-up': 'Step-up',
};

export function PipelineTrace({ trace }: { trace: TraceStep[] }) {
  if (!Array.isArray(trace) || trace.length === 0) return null;

  const failedAt = trace.findIndex((s) => !s.passed);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="label">Authorization pipeline</span>
        <span className="mono text-[11px] text-faint">
          {failedAt === -1
            ? `${trace.length}/${trace.length} gates passed`
            : `stopped at gate ${trace[failedAt]!.step}`}
        </span>
      </div>

      <ol className="flex flex-wrap gap-1.5">
        {trace.map((s, i) => {
          const label = LABELS[s.name] ?? s.name;
          return (
            <li
              key={`${s.step}-${s.name}`}
              className={cn(
                'animate-in-rise inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px]',
                s.passed
                  ? 'border-allow/25 bg-allow/[0.045] text-muted'
                  : 'border-deny/55 bg-deny/[0.08] font-medium text-deny',
              )}
              style={{ animationDelay: `${i * 55}ms` }}
            >
              {s.passed ? (
                <Check className="h-3 w-3 shrink-0 text-allow" />
              ) : (
                <X className="h-3 w-3 shrink-0" />
              )}
              {label}
              {s.detail ? (
                <span className={cn('mono', s.passed ? 'text-faint' : 'text-deny/80')}>
                  {s.detail}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {failedAt !== -1 ? (
        <p className="text-[12px] leading-relaxed text-faint">
          The gates before it passed. Authorization stopped here, so nothing downstream ran.
        </p>
      ) : null}
    </div>
  );
}
