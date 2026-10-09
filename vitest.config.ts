import { defineConfig } from 'vitest/config';

// Vitest 5: `test.projects` replaces the deprecated vitest.workspace.ts.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tools/*'],
  },
});
