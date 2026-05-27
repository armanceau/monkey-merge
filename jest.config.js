/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/src/__mocks__/vscode.ts'
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/__tests__/**', '!src/__mocks__/**', '!src/webview/**']
};
