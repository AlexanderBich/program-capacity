/** Integration tests: the real application against real PostgreSQL and Kafka containers, through its seams. */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  watchman: false,
  rootDir: "..",
  testRegex: "test/integration/.*\\.integration-spec\\.ts$",
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  globalSetup: "<rootDir>/test/support/global-setup.ts",
  globalTeardown: "<rootDir>/test/support/global-teardown.ts",
  setupFiles: ["<rootDir>/test/support/load-test-environment.ts"],
  testTimeout: 120000,
};
