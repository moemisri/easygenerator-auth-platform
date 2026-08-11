import { defineConfig, devices } from '@playwright/test';

const apiEnvironment = {
  NODE_ENV: 'test',
  VITEST: 'false',
  PORT: '3000',
  MONGODB_URI:
    'mongodb://127.0.0.1:27018/easygenerator_auth_test?replicaSet=rs0&directConnection=true',
  DB_NAME: 'easygenerator_auth_test',
  REDIS_URL: 'redis://127.0.0.1:6380',
  APP_ORIGIN: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  CSRF_SECRET: Buffer.alloc(32, 5).toString('base64'),
  IDENTITY_HASH_SECRET: Buffer.alloc(32, 6).toString('base64'),
  TRUST_PROXY_HOPS: '0',
  LOG_LEVEL: 'silent',
  ASSISTANT_ENABLED: 'false',
  SWAGGER_ENABLED: 'false',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @easygenerator/api exec tsx dist/main.js',
      url: 'http://localhost:3000/health/live',
      reuseExistingServer: false,
      timeout: 120_000,
      env: apiEnvironment,
    },
    {
      command:
        'pnpm --filter @easygenerator/web dev -- --host localhost --port 5173',
      url: 'http://localhost:5173/signin',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
