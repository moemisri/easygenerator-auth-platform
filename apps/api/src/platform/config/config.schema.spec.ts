import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { configSchema } from './config.schema';

const secret32Bytes = Buffer.alloc(32, 7).toString('base64');
const trailingLineTerminators = ['\n', '\r', '\r\n', '\u2028', '\u2029'];

const productionConfig = {
  NODE_ENV: 'production',
  PORT: '3000',
  MONGODB_URI: 'mongodb://database.example/easygenerator',
  DB_NAME: 'easygenerator_auth',
  REDIS_URL: 'rediss://cache.example',
  CSRF_SECRET: secret32Bytes,
  IDENTITY_HASH_SECRET: secret32Bytes,
  TRUST_PROXY_HOPS: '1',
  LOG_LEVEL: 'info',
  APP_ORIGIN: 'https://auth.example.com',
} as const;

describe('configSchema', () => {
  it('accepts the documented copied local environment without printing secrets', () => {
    const repositoryRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../..',
    );
    const environment = Object.fromEntries(
      fs
        .readFileSync(path.join(repositoryRoot, '.env.example'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const separator = line.indexOf('=');
          const value = line.slice(separator + 1);
          return [
            line.slice(0, separator),
            /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value,
          ];
        }),
    );

    const parsed = configSchema.parse(environment);
    expect(parsed.MONGODB_URI).toBe(
      'mongodb://127.0.0.1:27018/easygenerator_auth?replicaSet=rs0&directConnection=true',
    );
    expect(parsed.REDIS_URL).toBe('redis://127.0.0.1:6380');
    expect(Buffer.from(parsed.CSRF_SECRET, 'base64')).toHaveLength(32);
    expect(Buffer.from(parsed.IDENTITY_HASH_SECRET, 'base64')).toHaveLength(32);

    const sourced = spawnSync(
      'sh',
      [
        '-c',
        '. "$1"; test "$MONGODB_URI" = "$2"; test "$REDIS_URL" = "$3"',
        'environment-check',
        path.join(repositoryRoot, '.env.example'),
        parsed.MONGODB_URI,
        parsed.REDIS_URL,
      ],
      { encoding: 'utf8', shell: false },
    );
    expect(sourced.status).toBe(0);
    expect(sourced.stdout).toBe('');
    expect(sourced.stderr).toBe('');
  });

  it('treats empty optional environment values as absent in development', () => {
    const parsed = configSchema.parse({
      NODE_ENV: 'development',
      CSRF_SECRET: '',
      IDENTITY_HASH_SECRET: '',
      GEMINI_API_KEY: '',
      GEMINI_MODEL: '',
    });

    expect(parsed.CSRF_SECRET).toBeDefined();
    expect(parsed.IDENTITY_HASH_SECRET).toBeDefined();
    expect(parsed.GEMINI_API_KEY).toBeUndefined();
    expect(parsed.GEMINI_MODEL).toBeUndefined();
  });

  it('generates stable per-process development secrets instead of public constants', () => {
    const script = [
      "import { createHash } from 'node:crypto';",
      "import { configSchema } from './src/platform/config/config.schema.ts';",
      "const config = configSchema.parse({ NODE_ENV: 'development' });",
      "process.stdout.write(createHash('sha256').update(config.CSRF_SECRET + ':' + config.IDENTITY_HASH_SECRET).digest('hex'));",
    ].join(' ');
    const run = () =>
      spawnSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', script],
        {
          cwd: path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../../..',
          ),
          encoding: 'utf8',
          env: { ...process.env, APP_BOOTSTRAP: 'false' },
          shell: false,
        },
      );

    const first = run();
    const second = run();
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(second.stderr).toBe('');
    expect(first.stdout).toMatch(/^[0-9a-f]{64}$/);
    expect(second.stdout).toMatch(/^[0-9a-f]{64}$/);
    expect(first.stdout).not.toBe(second.stdout);

    const withinProcessA = configSchema.parse({ NODE_ENV: 'development' });
    const withinProcessB = configSchema.parse({ NODE_ENV: 'development' });
    expect(withinProcessA.CSRF_SECRET).toBe(withinProcessB.CSRF_SECRET);
    expect(withinProcessA.IDENTITY_HASH_SECRET).toBe(
      withinProcessB.IDENTITY_HASH_SECRET,
    );
  });

  it('still treats empty required production values as missing', () => {
    expect(() =>
      configSchema.parse({ ...productionConfig, CSRF_SECRET: '' }),
    ).toThrow(/CSRF_SECRET is required in production/);
  });

  it('refuses production without secure secrets', () => {
    expect(() =>
      configSchema.parse({ NODE_ENV: 'production', PORT: '3000' }),
    ).toThrow();
  });

  it.each([
    'MONGODB_URI',
    'DB_NAME',
    'REDIS_URL',
    'CSRF_SECRET',
    'IDENTITY_HASH_SECRET',
    'TRUST_PROXY_HOPS',
    'LOG_LEVEL',
  ] as const)('requires %s in production', (field) => {
    const candidate: Record<string, unknown> = { ...productionConfig };
    delete candidate[field];

    expect(() => configSchema.parse(candidate)).toThrow();
  });

  it('requires the fixed production database name', () => {
    expect(() =>
      configSchema.parse({ ...productionConfig, DB_NAME: 'other_database' }),
    ).toThrow();
  });

  it('accepts only the isolated integration database in test', () => {
    expect(
      configSchema.parse({
        NODE_ENV: 'test',
        DB_NAME: 'easygenerator_auth_test',
      }).DB_NAME,
    ).toBe('easygenerator_auth_test');
    expect(() =>
      configSchema.parse({ NODE_ENV: 'test', DB_NAME: 'easygenerator_auth' }),
    ).toThrow();
    expect(() =>
      configSchema.parse({ NODE_ENV: 'test', DB_NAME: 'other_database' }),
    ).toThrow();
  });

  it.each(['CSRF_SECRET', 'IDENTITY_HASH_SECRET'] as const)(
    'rejects %s when its decoded entropy is shorter than 32 bytes',
    (field) => {
      expect(() =>
        configSchema.parse({
          ...productionConfig,
          [field]: Buffer.alloc(31, 7).toString('base64'),
        }),
      ).toThrow();
    },
  );

  it.each(['CSRF_SECRET', 'IDENTITY_HASH_SECRET'] as const)(
    'rejects noncanonical base64 pad bits in %s',
    (field) => {
      const canonical = Buffer.alloc(32).toString('base64');
      const noncanonical = `${canonical.slice(0, -2)}B=`;
      expect(Buffer.from(noncanonical, 'base64').length).toBe(32);

      expect(() =>
        configSchema.parse({ ...productionConfig, [field]: noncanonical }),
      ).toThrow();
    },
  );

  it.each(['CSRF_SECRET', 'IDENTITY_HASH_SECRET'] as const)(
    'rejects Buffer-tolerated malformed base64 in %s',
    (field) => {
      expect(Buffer.from(`${secret32Bytes}!`, 'base64').length).toBe(32);
      expect(Buffer.from(secret32Bytes.slice(0, -1), 'base64').length).toBe(32);

      expect(() =>
        configSchema.parse({
          ...productionConfig,
          [field]: `${secret32Bytes}!`,
        }),
      ).toThrow();
      expect(() =>
        configSchema.parse({
          ...productionConfig,
          [field]: secret32Bytes.slice(0, -1),
        }),
      ).toThrow();
    },
  );

  it.each(trailingLineTerminators)(
    'rejects a base64 secret followed by line terminator %j',
    (terminator) => {
      expect(() =>
        configSchema.parse({
          ...productionConfig,
          CSRF_SECRET: `${secret32Bytes}${terminator}`,
        }),
      ).toThrow();
    },
  );

  it.each(['CSRF_SECRET', 'IDENTITY_HASH_SECRET'] as const)(
    'rejects malformed base64 in %s even when the text is long',
    (field) => {
      expect(() =>
        configSchema.parse({ ...productionConfig, [field]: '!'.repeat(64) }),
      ).toThrow();
    },
  );

  it('rejects insecure production cookies', () => {
    expect(() =>
      configSchema.parse({ ...productionConfig, COOKIE_SECURE: 'false' }),
    ).toThrow();
  });

  it('normalizes an explicit HTTPS application origin', () => {
    const parsed = configSchema.parse({
      ...productionConfig,
      APP_ORIGIN: 'https://auth.example.com/',
    });

    expect(parsed.APP_ORIGIN).toBe('https://auth.example.com');
  });

  it.each([
    'http://auth.example.com',
    'https://user:pass@auth.example.com',
    'https://auth.example.com/path',
    'https://auth.example.com?query=yes',
  ])('rejects a non-origin APP_ORIGIN value: %s', (origin) => {
    expect(() =>
      configSchema.parse({ ...productionConfig, APP_ORIGIN: origin }),
    ).toThrow();
  });

  it.each(['ftp://auth.example.com', 'file:///tmp/auth'])(
    'rejects unsupported APP_ORIGIN protocols outside production: %s',
    (origin) => {
      expect(() =>
        configSchema.parse({ NODE_ENV: 'test', APP_ORIGIN: origin }),
      ).toThrow();
    },
  );

  it('derives the application origin from a validated Render hostname', () => {
    const candidate: Record<string, unknown> = { ...productionConfig };
    delete candidate.APP_ORIGIN;
    candidate.RENDER_EXTERNAL_HOSTNAME = 'easygenerator-auth.onrender.com';

    expect(configSchema.parse(candidate).APP_ORIGIN).toBe(
      'https://easygenerator-auth.onrender.com',
    );
  });

  it.each([
    'easygenerator-auth.onrender.com.attacker.example',
    'other.easygenerator-auth.onrender.com',
    'easygenerator_auth.onrender.com',
    'https://easygenerator-auth.onrender.com',
  ])('rejects an untrusted Render hostname: %s', (hostname) => {
    const candidate: Record<string, unknown> = { ...productionConfig };
    delete candidate.APP_ORIGIN;
    candidate.RENDER_EXTERNAL_HOSTNAME = hostname;

    expect(() => configSchema.parse(candidate)).toThrow();
  });

  it.each(trailingLineTerminators)(
    'rejects a Render hostname followed by line terminator %j',
    (terminator) => {
      const candidate: Record<string, unknown> = { ...productionConfig };
      delete candidate.APP_ORIGIN;
      candidate.RENDER_EXTERNAL_HOSTNAME = `easygenerator-auth.onrender.com${terminator}`;

      expect(() => configSchema.parse(candidate)).toThrow();
    },
  );

  it('fails production startup when no allowed origin is available', () => {
    const candidate: Record<string, unknown> = { ...productionConfig };
    delete candidate.APP_ORIGIN;

    expect(() => configSchema.parse(candidate)).toThrow();
  });

  it.each(['GEMINI_API_KEY', 'GEMINI_MODEL'] as const)(
    'requires %s when the assistant is enabled',
    (field) => {
      const candidate: Record<string, unknown> = {
        ...productionConfig,
        ASSISTANT_ENABLED: 'true',
        GEMINI_API_KEY: 'test-key',
        GEMINI_MODEL: 'gemini-model',
      };
      delete candidate[field];

      expect(() => configSchema.parse(candidate)).toThrow();
    },
  );

  it('accepts only the public assistant corpus path', () => {
    expect(() =>
      configSchema.parse({
        ...productionConfig,
        ASSISTANT_ENABLED: 'true',
        GEMINI_API_KEY: 'test-key',
        GEMINI_MODEL: 'gemini-model',
        ASSISTANT_CORPUS_PATH: 'docs/private',
      }),
    ).toThrow();

    expect(
      configSchema.parse({
        ...productionConfig,
        ASSISTANT_ENABLED: 'true',
        GEMINI_API_KEY: 'test-key',
        GEMINI_MODEL: 'gemini-model',
        ASSISTANT_CORPUS_PATH: 'docs/assistant-public',
      }).ASSISTANT_CORPUS_PATH,
    ).toBe('docs/assistant-public');
  });

  it('uses local defaults only outside production', () => {
    const parsed = configSchema.parse({ NODE_ENV: 'test' });

    expect(parsed).toMatchObject({
      PORT: 3000,
      DB_NAME: 'easygenerator_auth_test',
      SESSION_TTL_SECONDS: 604800,
      COOKIE_SECURE: false,
      ASSISTANT_ENABLED: false,
      SWAGGER_ENABLED: false,
    });
  });

  it.each([
    ['true', true],
    ['false', false],
  ] as const)('parses SWAGGER_ENABLED=%s', (value, expected) => {
    expect(
      configSchema.parse({ NODE_ENV: 'test', SWAGGER_ENABLED: value })
        .SWAGGER_ENABLED,
    ).toBe(expected);
  });

  it('rejects a non-boolean SWAGGER_ENABLED value', () => {
    expect(() =>
      configSchema.parse({ NODE_ENV: 'test', SWAGGER_ENABLED: 'yes' }),
    ).toThrow();
  });

  it.each([
    ['true', true],
    ['false', false],
  ] as const)('parses SERVE_STATIC_ASSETS=%s', (value, expected) => {
    expect(
      configSchema.parse({ NODE_ENV: 'test', SERVE_STATIC_ASSETS: value })
        .SERVE_STATIC_ASSETS,
    ).toBe(expected);
  });

  it('rejects a non-boolean SERVE_STATIC_ASSETS value', () => {
    expect(() =>
      configSchema.parse({ NODE_ENV: 'test', SERVE_STATIC_ASSETS: 'yes' }),
    ).toThrow();
  });
});
