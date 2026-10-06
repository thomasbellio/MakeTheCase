import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest settings. Individual packages extend this with their own
 * coverage thresholds; AGENTS.md section 7.5 requires >= 90% in `analysis`.
 */
export const baseTestConfig = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});

export default baseTestConfig;
