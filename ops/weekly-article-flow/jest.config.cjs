module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/tests/integration/'],
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true
};
