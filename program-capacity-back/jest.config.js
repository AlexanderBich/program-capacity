/** Unit tests: all the logic, with every collaborator replaced. No database and no broker. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  coverageDirectory: '../coverage',
  coverageThreshold: { global: { statements: 100, branches: 100, functions: 100, lines: 100 } },
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    // Declarations: nothing runs here but decorators.
    '!**/*.module.ts',
    '!**/*.dto.ts',
    '!**/*.entity.ts',
    '!**/*.types.ts',
    '!**/*.enums.ts',
    '!**/*.constants.ts',
    '!**/*.interface.ts',
    '!**/*.decorator.ts',
    '!**/http/controllers/**',
    '!common/types/**',
    // They speak SQL: proved against a real PostgreSQL in the integration tests, where a mock proves nothing.
    '!**/infrastructure/repositories/**',
    // Bootstrap and developer tools.
    '!main.ts',
    '!data-source.ts',
    '!app.module.ts',
    '!app.setup.ts',
    '!dev/**',
    '!migrations/**',
  ],
};
