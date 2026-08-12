import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function fencedShellCommands(markdown) {
  return [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap((match) =>
    match[1]
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

describe('delivery policy artifacts', () => {
  it('defines only the five stable least-privilege CI jobs with locked runtimes', () => {
    const source = read('.github/workflows/ci.yml');
    const workflow = load(source);
    expect(Object.keys(workflow.jobs)).toEqual([
      'quality',
      'unit',
      'integration',
      'build',
      'browser',
    ]);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.env).toEqual({
      NODE_VERSION: '24.18.0',
      PNPM_VERSION: '11.0.6',
    });
    expect(workflow.on).toEqual({
      pull_request: null,
      push: { branches: ['main'] },
    });
    expect(workflow.concurrency).toEqual({
      group: 'ci-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    });
    for (const job of Object.values(workflow.jobs)) {
      expect(job['timeout-minutes']).toBeTypeOf('number');
      expect(
        job.steps.some((step) => step.run === 'pnpm install --frozen-lockfile'),
      ).toBe(true);
      const setupPnpm = job.steps.find(
        (step) => step.uses === 'pnpm/action-setup@v4',
      );
      const setupNode = job.steps.find(
        (step) => step.uses === 'actions/setup-node@v6',
      );
      expect(setupPnpm.with.version).toBe('${{ env.PNPM_VERSION }}');
      expect(setupNode.with).toEqual({
        'node-version': '${{ env.NODE_VERSION }}',
        cache: 'pnpm',
      });
    }
    expect(
      workflow.jobs.quality.steps.map((step) => step.run).filter(Boolean),
    ).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm format:check',
      'pnpm lint',
      'pnpm typecheck',
      'node scripts/validate-render-blueprint.mjs',
    ]);
    expect(
      workflow.jobs.build.steps.map((step) => step.run).filter(Boolean),
    ).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm build',
      'docker build --tag easygenerator-auth:ci .',
      'node scripts/verify-production-image.mjs easygenerator-auth:ci',
    ]);
    for (const name of ['integration', 'browser']) {
      const cleanup = workflow.jobs[name].steps.at(-1);
      expect(cleanup.if).toBe('always()');
      expect(cleanup.run).toBe(
        'docker compose -f compose.test.yaml down --volumes',
      );
    }
    const unitText = JSON.stringify(workflow.jobs.unit);
    expect(unitText).toContain('NODE_V8_COVERAGE');
    expect(unitText).toContain('unit-v8-coverage');
    expect(unitText).toContain('unit-test-reports');
    expect(source).not.toMatch(
      /MONGODB_URI|GEMINI_API_KEY|CSRF_SECRET|ADMIN_PASSWORD/,
    );
  });

  it('keeps the Render Blueprint same-region, private, checks-gated, and secret-free', () => {
    const source = read('render.yaml');
    const blueprint = load(source);
    expect(blueprint.services).toHaveLength(2);
    const [cache, web] = blueprint.services;
    expect(cache).toEqual({
      type: 'keyvalue',
      name: 'easygenerator-cache',
      plan: 'starter',
      region: 'frankfurt',
      ipAllowList: [],
      maxmemoryPolicy: 'noeviction',
      persistenceMode: 'off',
    });
    expect(web).toMatchObject({
      type: 'web',
      name: 'easygenerator-auth',
      runtime: 'docker',
      plan: 'starter',
      region: 'frankfurt',
      branch: 'main',
      autoDeployTrigger: 'checksPass',
      healthCheckPath: '/health/live',
    });
    const env = Object.fromEntries(
      web.envVars.map((entry) => [entry.key, entry]),
    );
    expect(Object.keys(env)).toEqual([
      'NODE_ENV',
      'DB_NAME',
      'COOKIE_SECURE',
      'TRUST_PROXY_HOPS',
      'SWAGGER_ENABLED',
      'ASSISTANT_ENABLED',
      'LOG_LEVEL',
      'REDIS_URL',
      'MONGODB_URI',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'CSRF_SECRET',
      'IDENTITY_HASH_SECRET',
    ]);
    expect(env.NODE_ENV).toEqual({ key: 'NODE_ENV', value: 'production' });
    expect(env.DB_NAME).toEqual({
      key: 'DB_NAME',
      value: 'easygenerator_auth',
    });
    expect(env.COOKIE_SECURE).toEqual({ key: 'COOKIE_SECURE', value: 'true' });
    expect(env.TRUST_PROXY_HOPS).toEqual({
      key: 'TRUST_PROXY_HOPS',
      value: '1',
    });
    expect(env.SWAGGER_ENABLED).toEqual({
      key: 'SWAGGER_ENABLED',
      value: 'true',
    });
    expect(env.ASSISTANT_ENABLED).toEqual({
      key: 'ASSISTANT_ENABLED',
      value: 'true',
    });
    expect(env.LOG_LEVEL).toEqual({ key: 'LOG_LEVEL', value: 'info' });
    expect(env.REDIS_URL.fromService).toEqual({
      type: 'keyvalue',
      name: 'easygenerator-cache',
      property: 'connectionString',
    });
    expect(env.MONGODB_URI).toEqual({ key: 'MONGODB_URI', sync: false });
    expect(env.GEMINI_API_KEY).toEqual({ key: 'GEMINI_API_KEY', sync: false });
    expect(env.GEMINI_MODEL).toEqual({ key: 'GEMINI_MODEL', sync: false });
    expect(env.CSRF_SECRET.generateValue).toBe(true);
    expect(env.IDENTITY_HASH_SECRET.generateValue).toBe(true);
    expect(env.CSRF_SECRET).toEqual({
      key: 'CSRF_SECRET',
      generateValue: true,
    });
    expect(env.IDENTITY_HASH_SECRET).toEqual({
      key: 'IDENTITY_HASH_SECRET',
      generateValue: true,
    });
    expect(env).not.toHaveProperty('APP_ORIGIN');
    expect(source).not.toMatch(/mongodb(?:\+srv)?:\/\/|AIzaSy/);
  });

  it('documents every supported environment key with empty secret fields', () => {
    const example = read('.env.example');
    const keys = example
      .trim()
      .split('\n')
      .map((line) => line.slice(0, line.indexOf('=')));
    expect(keys).toEqual([
      'NODE_ENV',
      'PORT',
      'MONGODB_URI',
      'DB_NAME',
      'REDIS_URL',
      'CSRF_SECRET',
      'IDENTITY_HASH_SECRET',
      'APP_ORIGIN',
      'COOKIE_SECURE',
      'TRUST_PROXY_HOPS',
      'LOG_LEVEL',
      'SWAGGER_ENABLED',
      'ASSISTANT_ENABLED',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'ADMIN_EMAIL',
      'ADMIN_NAME',
      'ADMIN_PASSWORD',
    ]);
    for (const key of [
      'CSRF_SECRET',
      'IDENTITY_HASH_SECRET',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'ADMIN_EMAIL',
      'ADMIN_NAME',
      'ADMIN_PASSWORD',
    ]) {
      expect(example).toContain(`${key}=\n`);
    }
    expect(example).toContain(
      "MONGODB_URI='mongodb://127.0.0.1:27018/easygenerator_auth?replicaSet=rs0&directConnection=true'",
    );
    expect(example).toContain('REDIS_URL=redis://127.0.0.1:6380');
  });

  it('keeps documentation aligned with opaque sessions and one same-origin service', () => {
    const documentation = [
      read('README.md'),
      read('AI.md'),
      read('docs/SECURITY.md'),
      read('docs/ARCHITECTURE.md'),
    ].join('\n');
    expect(documentation).toContain('opaque');
    expect(documentation).toContain('CSRF');
    expect(documentation).toContain(
      'pnpm --filter @easygenerator/api bootstrap:admin',
    );
    expect(documentation).not.toMatch(
      /refresh JWT|GEMINI_MODEL=|public Redis URL/i,
    );
    expect(read('README.md')).toContain('Live URL: not deployed yet');
    expect(read('README.md')).toContain('. ./.env.local');
    expect(documentation).toContain('60 minutes');
    expect(documentation).toContain('35 seconds');
    expect(documentation).toMatch(/change both entries\s+to `sync: false`/);
    expect(documentation).toContain(
      'canonical base64 value representing at least 32 random bytes',
    );
    expect(documentation).toContain('before the first deployment');
    expect(documentation).not.toMatch(/GEMINI_MODEL\s*=\s*[^\s`]+/);
    expect(documentation).not.toMatch(/redis(?:s)?:\/\/[^\s`]*@/i);
    for (const command of [
      'pnpm format:check',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test',
      'pnpm build',
      'pnpm e2e',
    ]) {
      expect(documentation).toContain(command);
      expect(JSON.parse(read('package.json')).scripts).toHaveProperty(
        command.slice('pnpm '.length),
      );
    }
    expect(JSON.parse(read('apps/api/package.json')).scripts).toHaveProperty(
      'bootstrap:admin',
      'node dist/cli/bootstrap-admin.js',
    );
  });

  it('maps every fenced shell command to a real script, file, or explicit shell setup', () => {
    const rootScripts = JSON.parse(read('package.json')).scripts;
    const workspacePackages = [
      JSON.parse(read('apps/api/package.json')),
      JSON.parse(read('apps/web/package.json')),
      JSON.parse(read('packages/contracts/package.json')),
    ];
    const commands = fencedShellCommands(read('README.md'));
    expect(commands).toHaveLength(26);

    for (const documented of commands) {
      const command = documented.replace(/^[A-Z_][A-Z0-9_]*=[^\s]+\s+/, '');
      if (['set -a', 'set +a', '. ./.env.local'].includes(command)) continue;
      const parts = command.split(/\s+/);
      if (parts[0] === 'node') {
        expect(fs.existsSync(path.join(root, parts[1]))).toBe(true);
        continue;
      }
      if (parts[0] === 'docker' && parts[1] === 'compose') {
        const fileFlag = parts.indexOf('-f');
        const composePath =
          fileFlag === -1 ? 'compose.yaml' : parts[fileFlag + 1];
        expect(fs.existsSync(path.join(root, composePath))).toBe(true);
        continue;
      }
      if (parts[0] === 'pnpm' && parts[1] === 'install') continue;
      if (parts[0] === 'pnpm' && parts[1] === '--filter') {
        const manifest = workspacePackages.find(
          ({ name }) => name === parts[2],
        );
        expect(manifest?.scripts).toHaveProperty(parts[3]);
        continue;
      }
      if (parts[0] === 'pnpm') {
        expect(rootScripts).toHaveProperty(parts[1]);
        continue;
      }
      throw new Error(`UNCLASSIFIED_DOCUMENTED_COMMAND:${parts[0]}`);
    }
  });

  it('prepares the ignored local environment before sourcing or starting development', () => {
    const [setup] = [...read('README.md').matchAll(/```bash\n([\s\S]*?)```/g)];
    expect(setup).toBeDefined();
    const commands = setup[1];
    const prepare = commands.indexOf('pnpm env:local');
    const source = commands.indexOf('. ./.env.local');
    const development = commands.indexOf('pnpm dev');
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(source).toBeGreaterThan(prepare);
    expect(development).toBeGreaterThan(source);
  });
});
