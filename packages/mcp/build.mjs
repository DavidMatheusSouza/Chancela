// One self-contained file: the SDK and the hashing it needs are inlined; the MCP
// SDK, viem and zod stay real dependencies.
import { build } from 'esbuild';
import { chmodSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/*', 'viem', 'viem/*', 'zod'],
  alias: { '@chancela/shared': '../sdk/shared-lite.ts' },
});
chmodSync('dist/cli.js', 0o755);
