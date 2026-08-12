import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { configSchema } from './config/config.schema.js';
import playwrightConfig from '../../../../playwright.config.ts';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function configuredEnvironmentKeys() {
  let schema = configSchema;
  while (schema.def?.type === 'pipe') schema = schema.def.in;
  return Object.keys(schema.shape);
}

describe('delivery policy artifacts', () => {
  it('runs the browser journey against built assets and preserves failure diagnostics', () => {
    const workflow = load(read('.github/workflows/ci.yml'));
    const steps = workflow.jobs.browser.steps;
    const commands = steps.map((step) => step.run).filter(Boolean);
    expect(commands.indexOf('pnpm build')).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf('pnpm build')).toBeLessThan(
      commands.indexOf('pnpm e2e'),
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        if: 'failure()',
        uses: 'actions/upload-artifact@v4',
        with: expect.objectContaining({ path: 'test-results/playwright' }),
      }),
    );
    expect(playwrightConfig.webServer).toHaveLength(2);
    expect(playwrightConfig.webServer[0]).toMatchObject({
      command: 'pnpm --filter @easygenerator/api exec node dist/main.js',
      url: 'http://localhost:5173/health/ready',
      env: {
        NODE_ENV: 'test',
        PORT: '5173',
        APP_ORIGIN: 'http://localhost:5173',
      },
    });
    expect(playwrightConfig.webServer[1]).toMatchObject({
      command:
        'pnpm --filter @easygenerator/api exec node test/support/assistant-e2e-server.mjs',
      url: 'http://localhost:5174/health/ready',
      env: {
        NODE_ENV: 'test',
        PORT: '5174',
        APP_ORIGIN: 'http://localhost:5174',
        ASSISTANT_ENABLED: 'true',
        ASSISTANT_E2E_SERVER: 'true',
      },
    });
  });

  it('runs tracked and reachable repository secret scans in CI', () => {
    const workflow = load(read('.github/workflows/ci.yml'));
    expect(workflow.jobs.quality.steps[0]).toMatchObject({
      uses: 'actions/checkout@v6',
      with: { 'fetch-depth': 0 },
    });
    const commands = workflow.jobs.quality.steps
      .map((step) => step.run)
      .filter(Boolean);
    expect(commands).toContain('node scripts/scan-secrets.mjs --tracked');
    expect(commands).toContain(
      'node scripts/scan-secrets.mjs --reachable HEAD',
    );
  });

  it('documents schema-supported environment configuration and waits for app readiness', () => {
    const exampleKeys = new Set(
      read('.env.example')
        .trim()
        .split('\n')
        .map((line) => line.slice(0, line.indexOf('='))),
    );
    for (const key of configuredEnvironmentKeys()) {
      expect(exampleKeys).toContain(key);
    }

    const compose = load(read('compose.yaml'));
    expect(compose.services.app.healthcheck.test.join(' ')).toContain(
      '/health/ready',
    );
  });

  it('resolves contract development imports from source while leaving default runtime exports built', () => {
    const resolve = (conditions) =>
      spawnSync(
        process.execPath,
        [
          ...(conditions === undefined ? [] : [`--conditions=${conditions}`]),
          '--input-type=module',
          '--eval',
          "process.stdout.write(import.meta.resolve('@easygenerator/contracts'))",
        ],
        { cwd: path.join(root, 'apps', 'api'), encoding: 'utf8' },
      );

    const development = resolve('development');
    expect(development.status).toBe(0);
    expect(development.stderr).toBe('');
    expect(development.stdout).toContain('/packages/contracts/src/index.ts');

    const production = resolve(undefined);
    expect(production.status).toBe(0);
    expect(production.stderr).toBe('');
    expect(production.stdout).toContain('/packages/contracts/dist/index.js');
  });

  it('deploys a ready-only production service that keeps every credential a secure dashboard input', () => {
    const blueprint = load(read('render.yaml'));
    const cache = blueprint.services.find(
      (service) => service.type === 'keyvalue',
    );
    const web = blueprint.services.find((service) => service.type === 'web');
    expect(cache.plan).toBe('free');
    expect(web.plan).toBe('free');
    expect(web.healthCheckPath).toBe('/health/ready');
    const env = Object.fromEntries(
      web.envVars.map((entry) => [entry.key, entry]),
    );
    expect(env.ASSISTANT_ENABLED).toEqual({
      key: 'ASSISTANT_ENABLED',
      value: 'true',
    });
    expect(env.SWAGGER_ENABLED).toEqual({
      key: 'SWAGGER_ENABLED',
      value: 'false',
    });
    expect(env.CSRF_SECRET).toEqual({ key: 'CSRF_SECRET', sync: false });
    expect(env.IDENTITY_HASH_SECRET).toEqual({
      key: 'IDENTITY_HASH_SECRET',
      sync: false,
    });
    // The assistant is enabled, so the schema requires both provider fields.
    // The key stays a secure dashboard input; only the non-secret model is literal.
    expect(env.GEMINI_API_KEY).toEqual({ key: 'GEMINI_API_KEY', sync: false });
    expect(env.GEMINI_MODEL.value).toMatch(/^gemini-[\w.-]+$/);
    expect(env.GEMINI_MODEL.sync).toBeUndefined();
  });
});
