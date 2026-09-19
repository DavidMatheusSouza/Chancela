import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortHash(value: string | null | undefined, lead = 6, tail = 4): string {
  if (!value) return '--';
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, lead)}...${value.slice(-tail)}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatMoney(minorUnits: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minorUnits / 100);
}

export const RISK_STYLE: Record<string, string> = {
  LOW: 'text-muted border-line',
  MEDIUM: 'text-warn border-warn/40',
  HIGH: 'text-warn border-warn/60',
  CRITICAL: 'text-deny border-deny/60',
};

export const DECISION_STYLE: Record<string, string> = {
  ALLOW: 'text-allow border-allow/50',
  DENY: 'text-deny border-deny/60',
  REQUIRE_APPROVAL: 'text-warn border-warn/60',
};
