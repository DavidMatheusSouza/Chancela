// One self-contained file: the SDK and the policy engine are inlined so
// `npx chancela-check` installs one small package and starts, rather than
// resolving a dependency tree first. The engine is the same source the service
// runs -- that is what makes a replay here mean anything.
// viem stays a real dependency -- it is what talks to Monad.
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
  external: ['viem', 'viem/*'],
  alias: {
    'chancela-sdk': '../sdk/src/index.ts',
    '@chancela/shared': '../shared/src/index.ts',
    '@chancela/policy-engine': '../policy-engine/src/index.ts',
  },
});
chmodSync('dist/cli.js', 0o755);
