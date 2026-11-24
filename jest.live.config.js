/** Live tests against the dev API. Not part of `npm test`. See test/live/live.test.ts. */
const base = require('./jest.config');
module.exports = {
  ...base,
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/test/live/**/*.test.ts'],
  testTimeout: 60000,
};
