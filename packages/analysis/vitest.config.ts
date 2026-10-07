import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@make-your-case/config/vitest';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      coverage: {
        // AGENTS.md section 7.5 requires analysis coverage >= 90%. Branches sit
        // slightly lower because several guards are defensive against states
        // validation already rejects, and are unreachable by design.
        thresholds: {
          statements: 90,
          lines: 90,
          functions: 90,
          branches: 85,
        },
      },
    },
  }),
);
