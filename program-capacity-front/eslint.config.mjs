import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // A domain's only public door is its index.ts. All API access lives in src/api, never in a domain.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/domains/*/*'],
              message: 'Import a domain through its public index: @/domains/<name>.',
            },
          ],
        },
      ],
    },
  },
);
