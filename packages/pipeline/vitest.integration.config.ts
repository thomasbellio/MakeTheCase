import { defineConfig } from 'vitest/config';

// Integration tests read TEST_DATABASE_URL. Loading the repo's .env here means
// `pnpm test:db` works without the caller exporting it by hand.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // No .env: the harness reports a clear error if the variable is still unset.
}

/**
 * Integration tests only. These need a live Postgres, so they are excluded from
 * the default `pnpm test` and run under `pnpm test:db` (AGENTS.md section 7.6).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
