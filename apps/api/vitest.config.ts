import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['development'],
  },
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['src/**/*.spec.{ts,mjs}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,mjs}'],
      exclude: ['src/**/*.spec.{ts,mjs}'],
      thresholds: {
        statements: 91.01,
        branches: 84.2,
        functions: 90.61,
        lines: 91.88,
      },
    },
  },
});
