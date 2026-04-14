import { jest } from '@jest/globals';

// Global test setup
beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['GITHUB_APP_ID'] = process.env['GITHUB_APP_ID'] || '123456';
  process.env['GITHUB_PRIVATE_KEY'] =
    process.env['GITHUB_PRIVATE_KEY'] ||
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0\n-----END RSA PRIVATE KEY-----\n';
  process.env['GITHUB_WEBHOOK_SECRET'] =
    process.env['GITHUB_WEBHOOK_SECRET'] || '0123456789abcdef';
});

afterAll(() => {
  // Clean up after all tests
});

beforeEach(() => {
  // Reset mocks before each test
  jest.clearAllMocks();
});

afterEach(() => {
  // Clean up after each test
});
