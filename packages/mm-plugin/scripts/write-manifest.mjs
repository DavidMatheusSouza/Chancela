/**
 * Write oclif.manifest.json.
 *
 * `mm plugins install` refuses a package without a prebuilt manifest
 * (PLUGIN_MANIFEST_FILE_MISSING), so it has to ship in the tarball. It is
 * produced by oclif's own plugin loader rather than written by hand, so it
 * cannot drift from what the command classes actually declare.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Plugin } from '@oclif/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = new Plugin({ root, type: 'core', ignoreManifest: true, errorOnManifestCreate: true });
await plugin.load();

const ids = Object.keys(plugin.manifest.commands).sort();
if (ids.length === 0) throw new Error('No commands found — did the TypeScript build run?');

writeFileSync(join(root, 'oclif.manifest.json'), JSON.stringify(plugin.manifest, null, 2) + '\n');
console.log(`oclif.manifest.json: ${ids.join(', ')}`);
