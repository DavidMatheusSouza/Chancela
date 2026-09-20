// Bundle the SDK into one file that stands on its own.
//
// In the repository it imports canonical JSON and hashing from @chancela/shared,
// which is a private workspace package. Published, it cannot: so those few
// functions are inlined, and viem -- a real dependency -- stays external.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  mainFields: ['module', 'main'],
  external: ['viem', 'viem/*'],
  alias: { '@chancela/shared': './shared-lite.ts' },
});
execFileSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });
