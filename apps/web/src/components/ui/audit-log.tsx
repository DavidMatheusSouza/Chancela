"use client"

import * as React from "react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"

/**
 * Audit Log — timestamped event timeline.
 *
 * Source: 21st.dev, @corr/audit-log. Two deviations from the published
 * component, both deliberate:
 *
 *  1. The upstream filter bar (`audit-log-utils/filters`) is not distributed
 *     with the registry entry, so it is dropped. Callers that need filtering
 *     already own it -- `/audit` filters server-side through the URL.
 *  2. `tone` was added. Upstream renders every status as the same neutral
 *     pill, which would make ALLOW and DENY indistinguishable -- the one thing
 *     this product may never do. Tones map onto the semantic palette, and pair
 *     colour with a border weight change so the difference survives a bad
 *     projector.
 */

export type AuditLogTone = "neutral" | "allow" | "deny" | "warn" | "chain"

export type AuditLogItem = {
  id: string
  title: string
  description?: string
  timestamp: string
  actor?: string
  type?: string
  status?: string
  tone?: AuditLogTone
  icon?: React.ReactNode
}

const TONES: Record<AuditLogTone, string> = {
  neutral: "border-line text-muted",
  allow: "border-allow/50 text-allow",
  deny: "border-deny/60 bg-deny/[0.07] text-deny",
  warn: "border-warn/60 text-warn",
  chain: "border-chain/50 text-chain",
}

export type AuditLogAction = {
  label: string
  icon?: React.ReactNode
  onSelect: (item: AuditLogItem) => void
  /** Hidden for items where the action has nothing to act on. */
  enabled?: (item: AuditLogItem) => boolean
}

export function AuditLog({
  items,
  actions = [],
  emptyMessage = "No audit log items yet.",
  className,
}: {
  items: AuditLogItem[]
  actions?: AuditLogAction[]
  emptyMessage?: string
  className?: string
}) {
  return (
    <div className={cn("grid gap-3", className)}>
      <div className="rounded-md border bg-card">
        {items.length > 0 ? (
          items.map((item, index) => {
            const available = actions.filter(
              (action) => action.enabled?.(item) ?? true,
            )

            const row = (
              <div className="relative flex gap-3 px-4 py-3">
                {index < items.length - 1 ? (
                  <div className="absolute bottom-0 left-[1.55rem] top-9 w-px bg-border" />
                ) : null}
                <div
                  className={cn(
                    "z-[1] flex size-5 shrink-0 items-center justify-center rounded-full border bg-background",
                    item.tone ? TONES[item.tone] : "text-muted-foreground",
                  )}
                >
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="mono text-[13px] font-medium text-ink">
                      {item.title}
                    </div>
                    <div className="mono text-[11.5px] text-faint">
                      {item.timestamp}
                    </div>
                  </div>
                  {item.description ? (
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.description}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {item.status ? (
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 font-medium",
                          item.tone ? TONES[item.tone] : TONES.neutral,
                        )}
                      >
                        {item.status}
                      </span>
                    ) : null}
                    {item.type ? (
                      <span className="rounded-full border border-line px-2 py-0.5 text-muted-foreground">
                        {item.type}
                      </span>
                    ) : null}
                    {item.actor ? (
                      <span className="mono text-[11.5px] text-faint">
                        {item.actor}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            )

            if (available.length === 0) {
              return <div key={item.id}>{row}</div>
            }

            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                <ContextMenuContent className="w-52">
                  {available.map((action, i) => (
                    <React.Fragment key={action.label}>
                      {i > 0 && i === available.length - 1 ? (
                        <ContextMenuSeparator />
                      ) : null}
                      <ContextMenuItem onSelect={() => action.onSelect(item)}>
                        {action.icon}
                        {action.label}
                      </ContextMenuItem>
                    </React.Fragment>
                  ))}
                </ContextMenuContent>
              </ContextMenu>
            )
          })
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  )
}

export default AuditLog
