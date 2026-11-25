/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/test/live/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { warnOnly: false } }],
  },
  moduleNameMapper: { '^finlight-client$': '<rootDir>/src/index.ts' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 15000,
};
