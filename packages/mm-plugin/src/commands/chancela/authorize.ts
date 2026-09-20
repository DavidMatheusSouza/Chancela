import { Flags } from '@oclif/core';
import { CommandError, PluginCommand } from '@metamask/agent-wallet/plugin';
import { ChancelaError, assertAllowed, authorize, parseParams, resolveApiUrl, type Decision } from '../../core.js';

/**
 * mm chancela authorize
 *
 * Exits non-zero on anything but ALLOW, so it composes as a gate:
 *
 *   mm chancela authorize --agent TA-001 --action TRANSFER_FUNDS \
 *     --params '{"amount":500000,"recipient":"0xabc"}' && mm transfer ...
 *
 * It declares no capabilities. A policy gate that cannot itself touch the
 * wallet is one fewer thing to trust.
 */
export default class ChancelaAuthorize extends PluginCommand<Decision> {
  protected readonly pluginCommandId = 'chancela:authorize';

  // The decision comes from Chancela, not from the MetaMask session.
  static requiresAuth = false;
  static requiresInit = false;

  static description =
    'Ask Chancela whether an agent may perform an action. Exits non-zero unless the answer is ALLOW.';

  static examples = [
    `<%= config.bin %> chancela authorize --agent TA-001 --action CREATE_CUSTOMER --params '{"name":"Joao"}'`,
    `<%= config.bin %> chancela authorize --agent TA-001 --action TRANSFER_FUNDS --params '{"amount":500000,"recipient":"0xabc"}' && <%= config.bin %> transfer ...`,
  ];

  static flags = {
    ...PluginCommand.baseFlags,
    agent: Flags.string({ description: 'Chancela agent id, e.g. TA-001', required: true }),
    action: Flags.string({ description: 'Action the agent wants to perform, e.g. TRANSFER_FUNDS', required: true }),
    params: Flags.string({ description: 'Action parameters as a JSON object' }),
    'api-url': Flags.string({ description: 'Chancela deployment URL (or set CHANCELA_API_URL)' }),
  };

  async execute(): Promise<Decision> {
    const f = this.ctx.flags as { agent: string; action: string; params?: string; 'api-url'?: string };
    try {
      const apiUrl = resolveApiUrl(f['api-url']);
      const decision = await authorize({ apiUrl }, f.agent, f.action, parseParams(f.params));
      return assertAllowed(decision);
    } catch (err) {
      if (err instanceof ChancelaError) throw new CommandError(err.code, err.message, err.hint);
      throw err;
    }
  }
}
