import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@make-your-case/config/vitest';

/**
 * Node by default, like every other package. View tests render React and opt
 * into a DOM per file with a `// @vitest-environment jsdom` docblock, so
 * server and ViewModel tests stay fast and cannot reach for `window`.
 */
export default mergeConfig(
  base,
  defineConfig({
    // The app's tsconfig preserves JSX for Next; tests compile it here.
    oxc: { jsx: { runtime: 'automatic' } },
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      coverage: { include: ['src/**/*.{ts,tsx}'] },
    },
  }),
);
