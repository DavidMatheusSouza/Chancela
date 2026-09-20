import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PluginCommand, PluginManifestSchema, RESERVED_CAPABILITIES } from '@metamask/agent-wallet/plugin';

import Audit from '../src/commands/chancela/audit.js';
import Authorize from '../src/commands/chancela/authorize.js';
import Passport from '../src/commands/chancela/passport.js';

// Keyed by command id so a command added to the manifest but not here fails loudly.
const COMMANDS: Record<string, { prototype: object; description?: string }> = {
  'chancela:audit': Audit,
  'chancela:authorize': Authorize,
  'chancela:passport': Passport,
};

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * These mirror the install-time checks in MetaMask's plugin reference, run
 * against MetaMask's own schema and base class rather than a description of
 * them. Each `it` names the error `mm plugins install` would raise.
 */
describe('mm plugin contract', () => {
  it('has a valid `mm` manifest block (PLUGIN_MANIFEST_INVALID)', () => {
    const parsed = PluginManifestSchema.safeParse(pkg.mm);
    expect(parsed.success).toBe(true);
    expect(pkg.mm.schemaVersion).toBe(1);
    expect(pkg.mm.minCliVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.mm.commands.length).toBeGreaterThan(0);
  });

  it('asks for no capabilities and no data access', () => {
    // A policy gate that cannot touch the wallet is one fewer thing to trust.
    expect(pkg.mm.capabilities).toEqual([]);
    for (const c of pkg.mm.commands) {
      expect(c.capabilities).toEqual([]);
      expect(c.dataAccess).toEqual([]);
      for (const reserved of RESERVED_CAPABILITIES) expect(c.capabilities).not.toContain(reserved);
    }
  });

  it('declares neither oclif hooks nor nested plugins (PLUGIN_HOOKS_FORBIDDEN)', () => {
    expect(pkg.oclif.hooks).toBeUndefined();
    expect(pkg.oclif.plugins).toBeUndefined();
  });

  it('does not collide with a built-in mm command (PLUGIN_ID_COLLISION)', () => {
    const builtin = ['auth', 'login', 'logout', 'init', 'reset', 'config', 'wallet', 'transfer', 'swap', 'perps',
      'predict', 'earn', 'price', 'token', 'tx', 'chains', 'decode', 'doctor', 'plugins', 'registry', 'help'];
    for (const c of pkg.mm.commands) expect(builtin).not.toContain(c.id.split(':')[0]);
  });

  it('ships a prebuilt oclif.manifest.json listing the same commands (PLUGIN_MANIFEST_FILE_MISSING)', () => {
    const path = new URL('../oclif.manifest.json', import.meta.url);
    expect(existsSync(path)).toBe(true);
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    expect(Object.keys(manifest.commands).sort()).toEqual(pkg.mm.commands.map((c: { id: string }) => c.id).sort());
    expect(pkg.files).toContain('oclif.manifest.json');
  });

  it('builds every command on PluginCommand (PLUGIN_INVALID_BASE)', async () => {
    for (const c of pkg.mm.commands) {
      const cmd = COMMANDS[c.id];
      expect(cmd, `no class imported for ${c.id}`).toBeDefined();
      expect(cmd!.prototype).toBeInstanceOf(PluginCommand);
      expect(typeof cmd!.description).toBe('string');
    }
  });

  it('overrides no sealed lifecycle member (PLUGIN_SEALED_OVERRIDE)', async () => {
    const sealed = ['run', 'runLifecycle', 'beforeExecute', 'afterExecute', 'init', 'withPluginIsolation'];
    for (const c of pkg.mm.commands) {
      const own = Object.getOwnPropertyNames(COMMANDS[c.id]!.prototype);
      for (const name of sealed) expect(own).not.toContain(name);
    }
  });
});
