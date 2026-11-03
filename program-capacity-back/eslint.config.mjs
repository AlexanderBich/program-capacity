import tseslint from 'typescript-eslint';

// Layer boundaries from architecture.md, enforced instead of remembered.
const restrictImports = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

const HTTP_LAYER = { group: ['**/http/**'], message: 'Nobody imports the http layer.' };
const APPLICATION_LAYER = {
  group: ['**/application/**'],
  message: 'infrastructure and entities must not depend on application.',
};
const HTTP_WORDS = {
  group: ['@nestjs/swagger'],
  message: 'Swagger decorators belong to DTOs in the http layer.',
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs', 'test/jest-integration.config.js', 'jest.config.js'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/modules/*/application/**/*.ts'],
    rules: restrictImports([HTTP_LAYER, HTTP_WORDS]),
  },
  {
    files: ['src/modules/*/infrastructure/**/*.ts', 'src/modules/*/entities/**/*.ts'],
    rules: restrictImports([HTTP_LAYER, APPLICATION_LAYER, HTTP_WORDS]),
  },
);
