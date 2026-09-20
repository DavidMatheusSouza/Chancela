import { Flags } from '@oclif/core';
import { CommandError, PluginCommand } from '@metamask/agent-wallet/plugin';
import { ChancelaError, passport, resolveApiUrl, type Passport } from '../../core.js';

/** mm chancela passport -- who an agent is, and what its policy grants. */
export default class ChancelaPassport extends PluginCommand<Passport> {
  protected readonly pluginCommandId = 'chancela:passport';

  static requiresAuth = false;
  static requiresInit = false;

  static description = "Show an agent's identity, status, policy version and granted permissions.";

  static examples = ['<%= config.bin %> chancela passport --agent TA-001'];

  static flags = {
    ...PluginCommand.baseFlags,
    agent: Flags.string({ description: 'Chancela agent id, e.g. TA-001', required: true }),
    'api-url': Flags.string({ description: 'Chancela deployment URL (or set CHANCELA_API_URL)' }),
  };

  async execute(): Promise<Passport> {
    const f = this.ctx.flags as { agent: string; 'api-url'?: string };
    try {
      return await passport({ apiUrl: resolveApiUrl(f['api-url']) }, f.agent);
    } catch (err) {
      if (err instanceof ChancelaError) throw new CommandError(err.code, err.message, err.hint);
      throw err;
    }
  }
}
