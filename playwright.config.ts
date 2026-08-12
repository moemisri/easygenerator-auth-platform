import { defineConfig, devices } from '@playwright/test';

const apiEnvironment = {
  NODE_ENV: 'test',
  VITEST: 'false',
  PORT: '5173',
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
  SERVE_STATIC_ASSETS: 'true',
};

const assistantApiEnvironment = {
  ...apiEnvironment,
  APP_BOOTSTRAP: 'false',
  PORT: '5174',
  APP_ORIGIN: 'http://localhost:5174',
  ASSISTANT_ENABLED: 'true',
  ASSISTANT_E2E_SERVER: 'true',
  GEMINI_API_KEY: 'unused-by-the-deterministic-e2e-provider',
  GEMINI_MODEL: 'unused-by-the-deterministic-e2e-provider',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === 'true' ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/playwright',
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
      testIgnore: /assistant-stream\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'assistant-stream',
      testMatch: /assistant-stream\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5174',
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @easygenerator/api exec node dist/main.js',
      url: 'http://localhost:5173/health/ready',
      reuseExistingServer: false,
      timeout: 120_000,
      env: apiEnvironment,
    },
    {
      command:
        'pnpm --filter @easygenerator/api exec node test/support/assistant-e2e-server.mjs',
      url: 'http://localhost:5174/health/ready',
      reuseExistingServer: false,
      timeout: 120_000,
      env: assistantApiEnvironment,
    },
  ],
});
