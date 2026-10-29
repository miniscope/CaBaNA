import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import solid from 'eslint-plugin-solid/configs/typescript';
import globals from 'globals';

// Every app and package source tree. Globbed rather than listed so a new app or
// package gets the Solid rules and browser globals without editing this file.
const SOURCE_FILES = ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'];

// Repo-wide import boundary.
const BOUNDARY_PATTERNS = [
  {
    group: ['@calab/*/src/*'],
    message: 'Import from the package barrel (@calab/<pkg>) instead of reaching into src/.',
  },
];

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'dist/',
      'apps/*/dist/',
      'packages/*/dist/',
      'crates/',
      '.planning/',
      '*.config.js',
      '*.config.ts',
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended (non-type-checked for speed)
  ...tseslint.configs.recommended,

  // SolidJS rules for every app and package
  {
    files: SOURCE_FILES,
    ...solid,
  },

  // Browser globals for every app and package
  {
    files: SOURCE_FILES,
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Worker globals for app workers/
  {
    files: ['apps/*/src/workers/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.worker,
      },
    },
  },

  // Node globals for build scripts and the Playwright suite (runs in Node)
  {
    files: ['scripts/**/*.{js,mjs,cjs,ts}', 'e2e/**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: BOUNDARY_PATTERNS }],
    },
  },

  // Pragmatic rule overrides
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // SolidJS-specific rule overrides (scoped to files where solid plugin is loaded)
  {
    files: SOURCE_FILES,
    rules: {
      // .map() is fine for small static arrays; <For> migration is incremental
      'solid/prefer-for': 'off',
      // String style props work and are more concise for simple cases
      'solid/style-prop': 'off',
      // Early returns in components are sometimes intentional (loading guards)
      'solid/components-return-once': 'warn',
      // ESLint 10 recommended rule; it can't see Solid's `ref={el}` JSX
      // assignment, so every `let el: HTMLElement | undefined` ref is a false positive.
      'no-unassigned-vars': 'off',
    },
  },
);
