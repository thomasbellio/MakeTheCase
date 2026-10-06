import tseslint from 'typescript-eslint';
import { boundariesConfig } from '@make-your-case/config/eslint/boundaries';

/**
 * Lints only the `__boundaries__` fixtures, which are deliberately illegal.
 *
 * The fixtures are excluded from every tsconfig on purpose, so this config
 * parses them without the type-aware project service. The boundary rules work
 * from import paths alone and need no type information.
 *
 * Driven by `pnpm lint:boundaries` (scripts/check-boundaries.mjs).
 */
export default [
  {
    files: ['**/__boundaries__/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: false },
    },
  },
  ...boundariesConfig,
];
