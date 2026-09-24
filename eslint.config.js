import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-test', 'node_modules', 'artifacts', 'test-results', 'playwright-report', 'scripts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', performance: 'readonly', console: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
);
