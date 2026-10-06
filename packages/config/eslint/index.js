import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Shared lint rules for every workspace.
 *
 * Encodes AGENTS.md section 11: TypeScript strict, no `any` (use `unknown` and
 * narrow), and no non-null assertions without an explanatory comment.
 */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // AGENTS.md section 11
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Typed result objects are preferred over throwing for expected failures,
      // so unhandled promises are a real bug class here.
      '@typescript-eslint/no-floating-promises': 'error',

      // `import type` must be explicit; verbatimModuleSyntax depends on it.
      '@typescript-eslint/consistent-type-imports': 'error',

      'no-console': 'off',
    },
  },
  {
    // Config files and standalone scripts are not part of any tsconfig
    // project, so type-aware rules cannot run on them.
    //
    // `disableTypeChecked` carries its own `languageOptions`, so it is spread
    // first and our settings applied on top; the reverse order silently drops
    // them.
    files: [
      '**/*.config.{js,mjs,cjs,ts,mts}',
      'eslint*.config.js',
      'scripts/**/*.{js,mjs}',
      'packages/config/**/*.js',
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: false, program: null },
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  prettier,
);

export default baseConfig;
