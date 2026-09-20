import { Flags } from '@oclif/core';
import { CommandError, PluginCommand } from '@metamask/agent-wallet/plugin';
import { ChancelaError, audit, resolveApiUrl, type AuditLine } from '../../core.js';

/** mm chancela audit -- what an agent tried, refusals included. */
export default class ChancelaAudit extends PluginCommand<AuditLine[]> {
  protected readonly pluginCommandId = 'chancela:audit';

  static requiresAuth = false;
  static requiresInit = false;

  static description = "List an agent's recent authorization decisions, with their on-chain proofs.";

  static examples = ['<%= config.bin %> chancela audit --agent TA-001 --limit 10'];

  static flags = {
    ...PluginCommand.baseFlags,
    agent: Flags.string({ description: 'Chancela agent id, e.g. TA-001', required: true }),
    limit: Flags.integer({ description: 'How many decisions to show', default: 20 }),
    'api-url': Flags.string({ description: 'Chancela deployment URL (or set CHANCELA_API_URL)' }),
  };

  async execute(): Promise<AuditLine[]> {
    const f = this.ctx.flags as { agent: string; limit: number; 'api-url'?: string };
    try {
      return await audit({ apiUrl: resolveApiUrl(f['api-url']) }, f.agent, f.limit);
    } catch (err) {
      if (err instanceof ChancelaError) throw new CommandError(err.code, err.message, err.hint);
      throw err;
    }
  }
}
