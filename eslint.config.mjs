import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'apps/api/**/*.{js,mjs,cjs,ts,tsx}',
      'apps/web/{vite,vitest}.config.ts',
      'packages/**/*.{js,mjs,cjs,ts,tsx}',
      'eslint.config.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      'apps/web/src/**/*.{js,mjs,cjs,ts,tsx}',
      'apps/web/tests/**/*.{js,mjs,cjs,ts,tsx}',
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  eslintConfigPrettier,
);
