import { baseConfig } from '@make-your-case/config/eslint';
import { boundariesConfig } from '@make-your-case/config/eslint/boundaries';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'fixtures/**',
      // Deliberately illegal imports, linted only by eslint.boundaries.config.js
      // via `pnpm lint:boundaries`.
      '**/__boundaries__/**',
    ],
  },
  ...baseConfig,
  ...boundariesConfig,
];
