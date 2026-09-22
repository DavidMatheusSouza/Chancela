import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Runs before anything imports the app: see test/setup.ts. Without it, a
    // shell that has the deployment's .env exported points the suite at the
    // live database.
    setupFiles: ['./test/setup.ts'],
  },
});
