import { CheckCircle2, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { Badge, Label, Mono } from './primitives';
import { cn, shortHash } from '@/lib/ui';

export interface VerdictProps {
  decision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL' | string;
  action: string;
  risk: string;
  reasonCode: string;
  reasonText: string;
  policyVersion: number;
  policyHash: string;
  auditId: string;
  proof: string;
  anchorStatus?: string;
  txUrl?: string | null;
}

/**
 * The authorization verdict.
 *
 * DENY is not "ALLOW in red". It is a heavier block, a different icon, a
 * different border treatment and a different information order -- the reason
 * comes first, because that is what a person needs when something is refused.
 */
export function Verdict(props: VerdictProps) {
  const denied = props.decision === 'DENY';
  const approval = props.decision === 'REQUIRE_APPROVAL';

  return (
    <div
      className={cn(
        'animate-in rounded-lg p-4',
        denied ? 'verdict-deny' : approval ? 'verdict-approval' : 'verdict-allow',
      )}
    >
      <div className="flex items-start gap-3">
        {denied ? (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-deny" />
        ) : approval ? (
          <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-allow" />
        )}

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'font-semibold tracking-tight',
                denied ? 'text-base text-deny' : approval ? 'text-base text-warn' : 'text-sm text-allow',
              )}
            >
              {denied ? 'ACTION BLOCKED' : approval ? 'APPROVAL REQUIRED' : 'AUTHORIZED'}
            </span>
            <Mono className="text-ink">{props.action}</Mono>
            <Badge tone={props.risk === 'CRITICAL' ? 'deny' : props.risk === 'LOW' ? 'neutral' : 'warn'}>
              {props.risk}
            </Badge>
          </div>

          {denied || approval ? (
            <div className="space-y-1">
              <Label>Reason</Label>
              <p className="text-sm text-ink">{props.reasonText}</p>
              <Mono className="text-faint">{props.reasonCode}</Mono>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1 sm:grid-cols-4">
            <div>
              <Label>Policy</Label>
              <Mono className="text-ink">v{props.policyVersion}</Mono>
            </div>
            <div>
              <Label>Policy hash</Label>
              <Mono>{shortHash(props.policyHash)}</Mono>
            </div>
            <div>
              <Label>Audit</Label>
              <Mono>{props.auditId}</Mono>
            </div>
            <div>
              <Label>Proof</Label>
              {props.txUrl ? (
                <a href={props.txUrl} target="_blank" rel="noreferrer" className="mono text-[12.5px] text-chain hover:underline">
                  {shortHash(props.proof)}
                </a>
              ) : (
                <Mono className={props.anchorStatus === 'PENDING' ? 'text-chain' : undefined}>
                  {shortHash(props.proof)}
                  {props.anchorStatus === 'PENDING' ? ' (anchoring)' : ''}
                  {props.anchorStatus === 'SKIPPED' ? ' (local)' : ''}
                </Mono>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
