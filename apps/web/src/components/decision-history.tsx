'use client';

import { CheckCircle2, Copy, ExternalLink, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { AuditLog, type AuditLogItem, type AuditLogTone } from '@/components/ui/audit-log';

export interface DecisionHistoryEntry {
  id: string;
  action: string;
  outcome: string;
  risk: string;
  reasonText: string;
  policyVersion: number;
  decisionHash: string;
  /** Precomputed on the server -- the explorer base URL is server config. */
  txUrl: string | null;
  anchorStatus: string;
  time: string;
}

const TONE: Record<string, AuditLogTone> = {
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_APPROVAL: 'warn',
};

function icon(outcome: string) {
  if (outcome === 'DENY') return <ShieldAlert className="size-3" />;
  if (outcome === 'REQUIRE_APPROVAL') return <ShieldQuestion className="size-3" />;
  return <CheckCircle2 className="size-3" />;
}

/**
 * This agent's decisions, newest first.
 *
 * The Passport answers "what may this agent do". This answers "what did it
 * actually try" -- including, and especially, the refusals. Each row keeps the
 * policy version that governed it, so the history stays readable after the
 * policy changes.
 */
export function DecisionHistory({ entries }: { entries: DecisionHistoryEntry[] }) {
  const items: AuditLogItem[] = entries.map((e) => ({
    id: e.id,
    title: e.action,
    description: e.reasonText,
    timestamp: e.time,
    status: e.outcome === 'REQUIRE_APPROVAL' ? 'APPROVAL' : e.outcome,
    type: e.risk,
    actor: `policy v${e.policyVersion} - ${e.txUrl ? 'anchored' : e.anchorStatus.toLowerCase()}`,
    tone: TONE[e.outcome] ?? 'neutral',
    icon: icon(e.outcome),
  }));

  const byId = new Map(entries.map((e) => [e.id, e]));

  return (
    <AuditLog
      items={items}
      emptyMessage="No decisions yet. Open the console and ask this agent to do something."
      actions={[
        {
          label: 'Open proof on explorer',
          icon: <ExternalLink />,
          enabled: (item) => Boolean(byId.get(item.id)?.txUrl),
          onSelect: (item) => {
            const url = byId.get(item.id)?.txUrl;
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          },
        },
        {
          label: 'Copy decision hash',
          icon: <Copy />,
          onSelect: (item) => {
            const hash = byId.get(item.id)?.decisionHash;
            if (hash) void navigator.clipboard?.writeText(hash);
          },
        },
      ]}
    />
  );
}
