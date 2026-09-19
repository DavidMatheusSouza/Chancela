'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Bot,
  ExternalLink,
  FileCheck2,
  LayoutDashboard,
  Plug,
  Plus,
  ScrollText,
  Settings,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';

export interface PaletteAgent {
  id: string;
  name: string;
}

/**
 * Command palette (Cmd/Ctrl+K).
 *
 * Deliberately includes the destructive-sounding entries (open an agent's
 * console, jump to blocked actions) because the fastest path to "what did my
 * agent try to do" is the one an operator actually needs under pressure.
 */
export function CommandPalette({
  agents,
  explorerUrl,
}: {
  agents: PaletteAgent[];
  explorerUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (href: string) => () => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search agents, policies, audit..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={go('/dashboard')}>
            <LayoutDashboard className="mr-2 h-4 w-4" /> Overview
          </CommandItem>
          <CommandItem onSelect={go('/agents')}>
            <Bot className="mr-2 h-4 w-4" /> Agents
          </CommandItem>
          <CommandItem onSelect={go('/policies')}>
            <FileCheck2 className="mr-2 h-4 w-4" /> Policies
          </CommandItem>
          <CommandItem onSelect={go('/activity')}>
            <Activity className="mr-2 h-4 w-4" /> Trust activity
          </CommandItem>
          <CommandItem onSelect={go('/audit')}>
            <ScrollText className="mr-2 h-4 w-4" /> Audit trail
          </CommandItem>
          <CommandItem onSelect={go('/integrations')}>
            <Plug className="mr-2 h-4 w-4" /> Integrations
          </CommandItem>
          <CommandItem onSelect={go('/settings')}>
            <Settings className="mr-2 h-4 w-4" /> Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Agents">
          {agents.map((agent) => (
            <CommandItem key={agent.id} value={`${agent.name} ${agent.id}`} onSelect={go(`/agents/${agent.id}`)}>
              <Bot className="mr-2 h-4 w-4" />
              {agent.name}
              <CommandShortcut className="mono">{agent.id}</CommandShortcut>
            </CommandItem>
          ))}
          {agents.map((agent) => (
            <CommandItem
              key={`${agent.id}-console`}
              value={`console ${agent.name} ${agent.id}`}
              onSelect={go(`/agents/${agent.id}/console`)}
            >
              <Terminal className="mr-2 h-4 w-4" />
              Open {agent.name} console
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={go('/agents?new=1')}>
            <Plus className="mr-2 h-4 w-4" /> Create agent
          </CommandItem>
          <CommandItem onSelect={go('/audit?decision=DENY')}>
            <ShieldAlert className="mr-2 h-4 w-4" /> View blocked actions
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              window.open(explorerUrl, '_blank', 'noopener');
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" /> Open Monad explorer
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
