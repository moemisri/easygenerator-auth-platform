import { Body, Controller, Get, Module, Post, Req } from '@nestjs/common';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrap, configureApplication, initializeAndListen } from './main';
import { DatabaseIndexInitializer } from './platform/database/database-index-initializer';
import { ProblemDetailsFilter } from './platform/errors/problem-details.filter';

type BoundaryRequest = {
  cookies: Record<string, string>;
  id: string;
  ip: string;
};

@Controller()
class BoundaryController {
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  ready() {
    return { status: 'ok', dependencies: {} };
  }

  @Get('boundary')
  boundary(@Req() request_: BoundaryRequest) {
    return {
      cookies: request_.cookies,
      id: request_.id,
      ip: request_.ip,
    };
  }

  @Post('echo')
  echo(@Body() body: unknown) {
    return body;
  }
}

@Module({ controllers: [BoundaryController] })
class BoundaryModule {}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('initializeAndListen', () => {
  it('initializes the app and security indexes before starting its listener', async () => {
    const order: string[] = [];
    const indexesReady = deferred();
    const initializer = {
      ensureSecurityCriticalIndexes: vi.fn(async () => {
        order.push('indexes');
        await indexesReady.promise;
      }),
    };
    const app = {
      get: vi.fn(() => initializer),
      init: vi.fn(() => {
        order.push('app.init');
        return Promise.resolve();
      }),
      listen: vi.fn(() => {
        order.push('app.listen');
        return Promise.resolve();
      }),
    };

    const startup = initializeAndListen(app, 3000);
    await vi.waitFor(() => expect(order).toEqual(['app.init', 'indexes']));
    expect(app.get).toHaveBeenCalledWith(DatabaseIndexInitializer);
    expect(app.listen).not.toHaveBeenCalled();

    indexesReady.resolve();
    await startup;

    expect(order).toEqual(['app.init', 'indexes', 'app.listen']);
    expect(app.listen).toHaveBeenCalledWith(3000, '0.0.0.0');
  });

  it('does not create a listener when security index readiness fails', async () => {
    const failure = new Error('security indexes unavailable');
    const initializer = {
      ensureSecurityCriticalIndexes: vi.fn().mockRejectedValue(failure),
    };
    const app = {
      get: vi.fn(() => initializer),
      init: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockResolvedValue(undefined),
    };

    await expect(initializeAndListen(app, 3000)).rejects.toBe(failure);

    expect(app.listen).not.toHaveBeenCalled();
  });
});

describe('bootstrap', () => {
  it('awaits application cleanup when startup fails after creation', async () => {
    const startupFailure = new Error('security indexes unavailable');
    const cleanupFinished = deferred();
    let openHandle: ReturnType<typeof setInterval> | undefined;
    const close = vi.fn(async () => {
      await cleanupFinished.promise;
      if (openHandle !== undefined) clearInterval(openHandle);
      openHandle = undefined;
    });
    const config = {
      get: vi.fn((key: string) => {
        if (key === 'PORT') return 3000;
        if (key === 'TRUST_PROXY_HOPS') return 0;
        return false;
      }),
    };
    const app = {
      close,
      enableShutdownHooks: vi.fn(),
      get: vi.fn((token: { name?: string }) => {
        if (token.name === 'ConfigService') return config;
        if (token.name === 'DatabaseIndexInitializer') {
          return {
            ensureSecurityCriticalIndexes: vi
              .fn()
              .mockRejectedValue(startupFailure),
          };
        }
        return {};
      }),
      init: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      setGlobalPrefix: vi.fn(),
      use: vi.fn(),
      useBodyParser: vi.fn(),
      useGlobalFilters: vi.fn(),
      useGlobalPipes: vi.fn(),
      useLogger: vi.fn(),
    };
    const createApplication = vi.fn(() => {
      openHandle = setInterval(() => undefined, 1000);
      return Promise.resolve(app as unknown as NestExpressApplication);
    });

    try {
      const startup = bootstrap(createApplication);
      let startupSettled = false;
      const outcome = startup.then(
        () => ({ status: 'resolved' as const }),
        (error: unknown) => ({ error, status: 'rejected' as const }),
      );
      void outcome.then(() => {
        startupSettled = true;
      });

      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(openHandle).toBeDefined();
      expect(startupSettled).toBe(false);

      cleanupFinished.resolve();

      await expect(outcome).resolves.toEqual({
        error: startupFailure,
        status: 'rejected',
      });
      expect(openHandle).toBeUndefined();
    } finally {
      cleanupFinished.resolve();
      if (openHandle !== undefined) clearInterval(openHandle);
    }
  });
});

describe('application entrypoint', () => {
  const apiRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );

  function runMain(appBootstrap: 'false' | 'true') {
    return spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: apiRoot,
      encoding: 'utf8',
      env: {
        APP_BOOTSTRAP: appBootstrap,
        NODE_ENV: 'production',
      },
      shell: false,
    });
  }

  it('uses APP_BOOTSTRAP=false as the explicit import-only switch', () => {
    const result = runMain('false');

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('terminates nonzero with a sanitized startup diagnostic', () => {
    const result = runMain('true');

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Application startup failed.\n');
  });
});

describe('configureApplication', () => {
  let app: NestExpressApplication;

  async function createApp(swaggerEnabled = false) {
    const module = await Test.createTestingModule({
      imports: [BoundaryModule],
    }).compile();
    const createdApp = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApplication(
      createdApp,
      { TRUST_PROXY_HOPS: 1, SWAGGER_ENABLED: swaggerEnabled },
      new ProblemDetailsFilter({ error: () => undefined }),
    );
    await createdApp.init();
    return createdApp;
  }

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps health routes outside the versioned API prefix', async () => {
    const statuses: number[] = [];
    for (const path of [
      '/health/live',
      '/health/ready',
      '/api/v1/health/live',
      '/boundary',
      '/api/v1/boundary',
    ]) {
      statuses.push((await request(app.getHttpServer()).get(path)).status);
    }
    expect(statuses).toEqual([200, 200, 404, 404, 200]);
  });

  it('uses a validated request ID, trusted proxy hops, cookies, and Helmet', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/boundary')
      .set('Cookie', 'theme=dark')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('X-Request-Id', 'attacker-controlled')
      .expect(200);

    const body = response.body as BoundaryRequest;
    expect(body).toMatchObject({
      cookies: { theme: 'dark' },
      ip: '203.0.113.9',
    });
    expect(body.id).not.toBe('attacker-controlled');
    expect(response.headers['x-request-id']).toBe(body.id);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(response.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('propagates a valid edge request ID through the HTTP boundary', async () => {
    const requestId = '123e4567-e89b-42d3-a456-426614174000';
    const response = await request(app.getHttpServer())
      .get('/api/v1/boundary')
      .set('X-Request-Id', requestId)
      .expect(200);

    expect((response.body as BoundaryRequest).id).toBe(requestId);
    expect(response.headers['x-request-id']).toBe(requestId);
  });

  it('rejects JSON bodies larger than 32 KiB with a sanitized problem', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/echo')
      .set('Content-Type', 'application/json')
      .send({ value: 'x'.repeat(32 * 1024) })
      .expect(413);

    expect(response.body).toMatchObject({
      status: 413,
      code: 'HTTP_413',
    });
    expect(response.body).not.toHaveProperty('stack');
  });

  it('does not mount OpenAPI routes when documentation is disabled', async () => {
    for (const path of [
      '/api/docs',
      '/API/DOCS',
      '/api/docs/',
      '/api/docs/assets/example.js',
      '/api/docs-json',
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(404);
      expect(response.headers['content-security-policy']).not.toContain(
        "'unsafe-inline'",
      );
    }
  });

  it('mounts enabled documentation without weakening CSP outside the exact UI subtree', async () => {
    await app.close();
    app = await createApp(true);

    const docs = await request(app.getHttpServer())
      .get('/api/docs')
      .expect(200);
    const uppercaseDocs = await request(app.getHttpServer())
      .get('/API/DOCS')
      .expect(200);
    const trailingDocs = await request(app.getHttpServer())
      .get('/api/docs/')
      .expect(200);
    const docsAsset = await request(app.getHttpServer())
      .get('/api/docs/swagger-ui.css')
      .expect(200);
    const document = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const uppercaseDocument = await request(app.getHttpServer())
      .get('/API/DOCS-JSON')
      .expect(200);
    const yamlDocument = await request(app.getHttpServer())
      .get('/api/docs-yaml')
      .expect(404);
    const api = await request(app.getHttpServer())
      .get('/api/v1/boundary')
      .expect(200);
    const health = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    const lookalike = await request(app.getHttpServer())
      .get('/api/docs-json/anything')
      .expect(404);
    const prefixLookalike = await request(app.getHttpServer())
      .get('/api/docsish')
      .expect(404);

    for (const response of [docs, uppercaseDocs, trailingDocs, docsAsset]) {
      expect(response.headers['content-security-policy']).toContain(
        "script-src 'self' 'unsafe-inline'",
      );
      expect(response.headers['content-security-policy']).toContain(
        "style-src 'self' 'unsafe-inline'",
      );
    }

    for (const response of [
      document,
      uppercaseDocument,
      yamlDocument,
      api,
      health,
      lookalike,
      prefixLookalike,
    ]) {
      expect(response.headers['content-security-policy']).not.toContain(
        "'unsafe-inline'",
      );
    }
  });
});
