import nextVitals from 'eslint-config-next/core-web-vitals'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  ...nextVitals.map((config) => ({ ...config, files: ['src/app/**/*.{ts,tsx}'] })),
  globalIgnores(['dist', 'dist-server', 'coverage', '.next', '.next-e2e', '.playwright-browsers', 'playwright-report', 'test-results', 'blob-report', 'out', 'next-env.d.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/app/**'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  { files: ['server/**/*.ts'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
])
