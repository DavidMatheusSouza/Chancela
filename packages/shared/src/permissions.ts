import type { RiskLevel, ToolDescriptor } from './types';

/**
 * Permission catalogue.
 *
 * A permission is a capability name. A tool declares which permission it
 * requires. A policy grants a set of permissions. Nothing else grants anything.
 */
export const PERMISSIONS = [
  'READ_CUSTOMERS',
  'CREATE_CUSTOMER',
  'UPDATE_CUSTOMER',
  'DELETE_CUSTOMER',
  'SEND_PROPOSAL',
  'SEND_MESSAGE',
  'READ_TREASURY',
  'TRANSFER_FUNDS',
  'PLACE_ORDER',
  'CHANGE_POLICY',
  'CHANGE_OWNER',
  'DELETE_AGENT',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  READ_CUSTOMERS: 'Read customers',
  CREATE_CUSTOMER: 'Create customer',
  UPDATE_CUSTOMER: 'Update customer',
  DELETE_CUSTOMER: 'Delete customer',
  SEND_PROPOSAL: 'Send proposal',
  SEND_MESSAGE: 'Send message',
  READ_TREASURY: 'Read treasury balance',
  TRANSFER_FUNDS: 'Transfer funds',
  PLACE_ORDER: 'Place trade order',
  CHANGE_POLICY: 'Change policy',
  CHANGE_OWNER: 'Change owner',
  DELETE_AGENT: 'Delete agent',
};

/**
 * Tool Registry.
 *
 * The single source of truth for "what can be attempted at all". An action that
 * is not in this registry can never be authorized -- see UNKNOWN_ACTION.
 *
 * `risk` here is authoritative. The risk value suggested by an LLM is recorded
 * for display and then discarded.
 */
export const TOOL_REGISTRY: readonly ToolDescriptor[] = [
  {
    toolId: 'READ_CUSTOMERS',
    label: 'Read customers',
    description: 'List or search customer records.',
    requiredPermission: 'READ_CUSTOMERS',
    risk: 'LOW',
    movesValue: false,
    enabled: true,
  },
  {
    toolId: 'CREATE_CUSTOMER',
    label: 'Create customer',
    description: 'Create a new customer record.',
    requiredPermission: 'CREATE_CUSTOMER',
    risk: 'LOW',
    movesValue: false,
    enabled: true,
  },
  {
    toolId: 'UPDATE_CUSTOMER',
    label: 'Update customer',
    description: 'Modify an existing customer record.',
    requiredPermission: 'UPDATE_CUSTOMER',
    risk: 'MEDIUM',
    movesValue: false,
    enabled: true,
  },
  {
    toolId: 'DELETE_CUSTOMER',
    label: 'Delete customer',
    description: 'Permanently delete a customer record.',
    requiredPermission: 'DELETE_CUSTOMER',
    risk: 'CRITICAL',
    movesValue: false,
    enabled: true,
  },
  {
    toolId: 'SEND_PROPOSAL',
    label: 'Send proposal',
    description: 'Send a commercial proposal to a customer.',
    requiredPermission: 'SEND_PROPOSAL',
    risk: 'MEDIUM',
    movesValue: false,
    enabled: true,
  },
  {
    toolId: 'SEND_MESSAGE',
    label: 'Send message',
    description: 'Send a message on behalf of the owner.',
    requiredPermission: 'SEND_MESSAGE',
    risk: 'MEDIUM',
    movesValue: false,
    enabled: true,
  },
  {
    toolId: 'READ_TREASURY',
    label: 'Read treasury',
    description: 'Read the balance of the agent wallet.',
    requiredPermission: 'READ_TREASURY',
    risk: 'LOW',
    movesValue: false,
    enabled: true,
  },
  {
    toolId: 'TRANSFER_FUNDS',
    label: 'Transfer funds',
    description: 'Move value out of the agent wallet. Parameters: amount (cents), recipient (a name), recipientAddress (0x address, if given).',
    requiredPermission: 'TRANSFER_FUNDS',
    risk: 'CRITICAL',
    movesValue: true,
    enabled: true,
  },
  {
    toolId: 'PLACE_ORDER',
    label: 'Place trade order',
    description:
      'Place a buy or sell order on a market. Parameters: amount (order notional in cents), market (e.g. "MON/USDC"), side ("BUY" or "SELL"), orderType ("MARKET" or "LIMIT").',
    requiredPermission: 'PLACE_ORDER',
    // HIGH, not CRITICAL like a transfer: a trading agent places orders all day,
    // and at CRITICAL no step-up threshold could let a single one through without
    // a human. An order above 80% of the per-order ceiling escalates to CRITICAL,
    // so an owner who sets the threshold at CRITICAL approves exactly those.
    risk: 'HIGH',
    movesValue: true,
    enabled: true,
  },
  {
    toolId: 'CHANGE_POLICY',
    label: 'Change policy',
    description: 'Amend the policy bound to this agent.',
    requiredPermission: 'CHANGE_POLICY',
    risk: 'HIGH',
    movesValue: false,
    enabled: true,
  },
  {
    toolId: 'CHANGE_OWNER',
    label: 'Change owner',
    description: 'Transfer ownership of this agent.',
    requiredPermission: 'CHANGE_OWNER',
    risk: 'CRITICAL',
    movesValue: false,
    enabled: true,
  },
  {
    toolId: 'DELETE_AGENT',
    label: 'Delete agent',
    description: 'Permanently revoke this agent.',
    requiredPermission: 'DELETE_AGENT',
    risk: 'CRITICAL',
    movesValue: false,
    enabled: true,
  },
];

const TOOL_INDEX = new Map(TOOL_REGISTRY.map((t) => [t.toolId, t]));

export function lookupTool(toolId: string): ToolDescriptor | undefined {
  return TOOL_INDEX.get(toolId);
}

export function baselineRisk(toolId: string): RiskLevel | undefined {
  return TOOL_INDEX.get(toolId)?.risk;
}

/** Actions that must never be authorised on the LLM path alone. */
export const CRITICAL_ACTIONS: readonly string[] = TOOL_REGISTRY.filter(
  (t) => t.risk === 'CRITICAL' || t.toolId === 'CHANGE_POLICY',
).map((t) => t.toolId);
