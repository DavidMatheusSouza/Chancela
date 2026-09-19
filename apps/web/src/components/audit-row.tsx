'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { PipelineTrace, type TraceStep } from '@/components/pipeline-trace';
import { DecisionPill, Label, Mono, RiskPill } from '@/components/primitives';
import { cn, formatTime, shortHash } from '@/lib/ui';

export interface AuditEntry {
  id: string;
  agentId: string;
  action: string;
  outcome: string;
  risk: string;
  reasonCode: string;
  reasonText: string;
  policyVersion: number;
  policyHash: string;
  intentHash: string;
  decisionHash: string;
  parameters: Record<string, unknown>;
  trace: TraceStep[];
  anchorStatus: string;
  txUrl: string | null;
  txHash: string | null;
  blockNumber: string | null;
  auditId: string;
  createdAt: string;
}

/**
 * One audit event, summary first.
 *
 * Progressive disclosure, because the two readers want different things: a
 * person scanning for the refusals needs six columns, and a person who found
 * one needs everything that produced it. Opening a row answers, in order, what
 * was asked, which gates it passed, why it stopped, and where the proof is --
 * rather than making them reconstruct that from a hash.
 */
export function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const denied = entry.outcome === 'DENY';

  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'cursor-pointer border-b border-line/60 transition-colors hover:bg-raised/50',
          denied && entry.risk === 'CRITICAL' && 'bg-deny/[0.035]',
          open && 'bg-raised/40',
        )}
      >
        <td className="px-4 py-2">
          <span className="flex items-center gap-1.5">
            <ChevronRight
              className={cn('h-3 w-3 text-faint transition-transform', open && 'rotate-90')}
            />
            <Mono>{formatTime(entry.createdAt)}</Mono>
          </span>
        </td>
        <td className="px-4 py-2 text-[13px] text-muted">{entry.agentId}</td>
        <td className="px-4 py-2"><Mono className="text-ink">{entry.action}</Mono></td>
        <td className="px-4 py-2"><DecisionPill decision={entry.outcome} /></td>
        <td className="px-4 py-2"><RiskPill risk={entry.risk} /></td>
        <td className="px-4 py-2"><Mono className="text-faint">{entry.reasonCode}</Mono></td>
        <td className="px-4 py-2"><Mono>v{entry.policyVersion}</Mono></td>
        <td className="px-4 py-2">
          {entry.txUrl ? (
            <a
              href={entry.txUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mono text-[12px] text-chain hover:underline"
            >
              {shortHash(entry.txHash)}
            </a>
          ) : (
            <Mono className="text-faint">{entry.anchorStatus.toLowerCase()}</Mono>
          )}
        </td>
      </tr>

      {open ? (
        <tr className="border-b border-line/60 bg-bg">
          <td colSpan={8} className="px-4 py-5">
            <div className="animate-in-rise space-y-5">
              <div>
                <Label>Why</Label>
                <p className={cn('mt-1 text-[13.5px]', denied ? 'text-deny' : 'text-ink')}>
                  {entry.reasonText}
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <Label>Parameters as evaluated</Label>
                  <pre className="mono mt-1.5 overflow-x-auto rounded-md border border-line bg-surface p-3 text-[12px] text-muted">
                    {JSON.stringify(entry.parameters ?? {}, null, 2)}
                  </pre>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label>Intent hash</Label>
                    <Mono className="block break-all text-[11.5px]">{entry.intentHash}</Mono>
                  </div>
                  <div>
                    <Label>Policy hash (v{entry.policyVersion})</Label>
                    <Mono className="block break-all text-[11.5px]">{entry.policyHash}</Mono>
                  </div>
                  <div>
                    <Label>Decision hash</Label>
                    <Mono className="block break-all text-[11.5px]">{entry.decisionHash}</Mono>
                  </div>
                </div>
              </div>

              {entry.trace?.length ? <PipelineTrace trace={entry.trace} /> : null}

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4">
                <div>
                  <Label>Audit</Label>
                  <Mono>{entry.auditId}</Mono>
                </div>
                <div>
                  <Label>Anchor</Label>
                  <Mono className={entry.txUrl ? 'text-chain' : 'text-faint'}>
                    {entry.anchorStatus}
                    {entry.blockNumber ? ` · block ${entry.blockNumber}` : ''}
                  </Mono>
                </div>
                <div className="ml-auto flex gap-2">
                  <Link
                    href={`/agents/${entry.agentId}`}
                    className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-ink"
                  >
                    Agent passport
                  </Link>
                  <a
                    href={`/api/proofs/${entry.auditId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-ink"
                  >
                    Verify proof
                  </a>
                  {entry.txUrl ? (
                    <a
                      href={entry.txUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-chain/40 bg-chain/10 px-2.5 py-1 text-[12px] text-chain"
                    >
                      Monad explorer <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
