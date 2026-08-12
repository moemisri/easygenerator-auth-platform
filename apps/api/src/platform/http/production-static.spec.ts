import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../../main.js';
import {
  registerSpaFallback,
  registerSpaHosting,
  shouldServeSpaFallback,
} from './spa-fallback.js';
import { ProblemDetailsFilter } from '../errors/problem-details.filter.js';

const spaMarker = '<main>production-spa-entry</main>';

@Controller()
class ProductionBoundaryController {
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }
}

describe('production static hosting', () => {
  let app: NestExpressApplication;
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eg-static-'));
    await fs.mkdir(path.join(fixtureRoot, 'assets'));
    await fs.writeFile(
      path.join(fixtureRoot, 'index.html'),
      `<!doctype html>${spaMarker}`,
    );
    await fs.writeFile(
      path.join(fixtureRoot, 'assets', 'fixture.svg'),
      '<svg id="exact-fixture"></svg>',
    );

    @Module({
      controllers: [ProductionBoundaryController],
    })
    class ProductionBoundaryModule {}

    app = await NestFactory.create<NestExpressApplication>(
      ProductionBoundaryModule,
      {
        bodyParser: false,
        logger: false,
      },
    );
    configureApplication(
      app,
      { TRUST_PROXY_HOPS: 0, SWAGGER_ENABLED: true },
      new ProblemDetailsFilter({ error: () => undefined }),
    );
    registerSpaHosting(app.getHttpAdapter(), true, { staticRoot: fixtureRoot });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(fixtureRoot, { recursive: true });
  });

  it.each(['/', '/signin', '/app'])(
    'serves the SPA entry for browser route %s',
    async (browserPath) => {
      const response = await request(app.getHttpServer())
        .get(browserPath)
        .expect(200);
      expect(response.text).toContain(spaMarker);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
    },
  );

  it('serves an exact asset with its content type', async () => {
    const asset = await request(app.getHttpServer())
      .get('/assets/fixture.svg')
      .expect(200);
    expect(Buffer.from(asset.body).toString('utf8')).toBe(
      '<svg id="exact-fixture"></svg>',
    );
    expect(asset.headers['content-type']).toMatch(/^image\/svg\+xml/);
  });

  it.each([
    '/assets/missing.js',
    '/favicon.ico',
    '/api',
    '/api/v1/not-a-route',
    '/health',
    '/health/not-a-route',
  ])('never rewrites boundary path %s', async (boundaryPath) => {
    const response = await request(app.getHttpServer())
      .get(boundaryPath)
      .expect(404);
    expect(response.text).not.toContain(spaMarker);
  });

  it('preserves health JSON and the feature-gated OpenAPI CSP boundary', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });

    const document = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(document.headers['content-security-policy']).not.toContain(
      "'unsafe-inline'",
    );
    expect(document.text).not.toContain(spaMarker);

    const docs = await request(app.getHttpServer())
      .get('/api/docs')
      .expect(200);
    expect(docs.headers['content-security-policy']).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
  });

  it('uses the explicit fallback for deep routes when static assets are enabled', async () => {
    expect.hasAssertions();
    @Module({ controllers: [ProductionBoundaryController] })
    class FallbackOnlyModule {}

    const fallbackApp = await NestFactory.create<NestExpressApplication>(
      FallbackOnlyModule,
      { bodyParser: false, logger: false },
    );
    configureApplication(
      fallbackApp,
      { TRUST_PROXY_HOPS: 0, SWAGGER_ENABLED: false },
      new ProblemDetailsFilter({ error: () => undefined }),
    );
    registerSpaFallback(fallbackApp.getHttpAdapter().getInstance(), true, {
      spaEntryPath: path.join(fixtureRoot, 'index.html'),
    });
    await fallbackApp.init();

    try {
      const [deepRoute, apiBoundary, assetBoundary] = await Promise.all([
        request(fallbackApp.getHttpServer()).get('/signin'),
        request(fallbackApp.getHttpServer()).get('/api/v1/missing'),
        request(fallbackApp.getHttpServer()).get('/assets/missing.js'),
      ]);

      expect({ status: deepRoute.status, text: deepRoute.text }).toEqual({
        status: 200,
        text: `<!doctype html>${spaMarker}`,
      });
      expect([apiBoundary.status, assetBoundary.status]).toEqual([404, 404]);
    } finally {
      await fallbackApp.close();
    }
  });

  it('enables the fallback in production without the test-only static flag', () => {
    expect(shouldServeSpaFallback('production', false)).toBe(true);
    expect(shouldServeSpaFallback('test', 'true')).toBe(true);
    expect(shouldServeSpaFallback('test', false)).toBe(false);
    expect(shouldServeSpaFallback('test', 'false')).toBe(false);
  });
});

describe('spa hosting registration guards', () => {
  it('registers no middleware when static hosting is disabled', () => {
    const handlers: unknown[] = [];
    registerSpaFallback({ use: (handler) => handlers.push(handler) }, false, {
      nodeEnvironment: 'test',
    });
    expect(handlers).toEqual([]);
  });

  it('registers neither assets nor fallback when hosting is disabled', () => {
    const calls: string[] = [];
    registerSpaHosting(
      {
        getInstance: () => ({
          use: () => calls.push('use'),
        }),
        useStaticAssets: () => calls.push('static'),
      },
      false,
      { nodeEnvironment: 'test' },
    );
    expect(calls).toEqual([]);
  });

  it('fails loudly when the adapter cannot serve static assets', () => {
    expect(() =>
      registerSpaHosting(
        { getInstance: () => ({ use: () => undefined }) },
        true,
        {
          nodeEnvironment: 'test',
        },
      ),
    ).toThrow(/useStaticAssets/);
  });

  it('serves assets without an implicit index so HTML has one code path', () => {
    const staticCalls: Array<[string, Record<string, unknown>]> = [];
    registerSpaHosting(
      {
        getInstance: () => ({ use: () => undefined }),
        useStaticAssets: (rootPath, options) =>
          staticCalls.push([rootPath, options]),
      },
      true,
      { nodeEnvironment: 'test', staticRoot: '/srv/public' },
    );
    expect(staticCalls).toEqual([
      ['/srv/public', { index: false, fallthrough: true }],
    ]);
  });
});

describe('production static hosting from a dot-segment install path', () => {
  // Regression: `send` (behind res.sendFile) dotfile-checks every segment of an
  // absolute path when no `root` option is given, and defaults to
  // `dotfiles: 'ignore'`. Any deploy path containing a dot-prefixed directory
  // (a git worktree under .worktrees/, /opt/.releases/, ~/.local/share/...)
  // therefore turned every deep SPA route into a bare 404 while assets and `/`
  // kept working, because express.static sets `root` and only checks the
  // request-relative portion.
  let dotRoot: string;
  let staticRoot: string;
  let app: NestExpressApplication;

  beforeEach(async () => {
    dotRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eg-dotseg-'));
    staticRoot = path.join(dotRoot, '.worktrees', 'release', 'public');
    await fs.mkdir(path.join(staticRoot, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(staticRoot, 'index.html'),
      `<!doctype html>${spaMarker}`,
    );
    await fs.writeFile(
      path.join(staticRoot, 'assets', 'fixture.svg'),
      '<svg id="exact-fixture"></svg>',
    );

    @Module({
      controllers: [ProductionBoundaryController],
    })
    class DotSegmentModule {}

    app = await NestFactory.create<NestExpressApplication>(DotSegmentModule, {
      bodyParser: false,
      logger: false,
    });
    configureApplication(
      app,
      { TRUST_PROXY_HOPS: 0, SWAGGER_ENABLED: false },
      new ProblemDetailsFilter({ error: () => undefined }),
    );
    registerSpaHosting(app.getHttpAdapter(), true, { staticRoot });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(dotRoot, { recursive: true, force: true });
  });

  it('confirms the fixture really sits behind a dot-prefixed segment', () => {
    expect(
      staticRoot.split(path.sep).some((s) => s.length > 1 && s.startsWith('.')),
    ).toBe(true);
  });

  it.each(['/', '/signin', '/app', '/admin'])(
    'serves the SPA entry for browser route %s',
    async (browserPath) => {
      const response = await request(app.getHttpServer())
        .get(browserPath)
        .expect(200);
      expect(response.text).toContain(spaMarker);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
    },
  );

  it('still serves a real asset from the dot-segment root', async () => {
    const asset = await request(app.getHttpServer())
      .get('/assets/fixture.svg')
      .expect(200);
    expect(Buffer.from(asset.body).toString('utf8')).toBe(
      '<svg id="exact-fixture"></svg>',
    );
  });

  it.each(['/assets/missing.js', '/api/v1/not-a-route', '/health/not-a-route'])(
    'never rewrites boundary path %s',
    async (boundaryPath) => {
      const response = await request(app.getHttpServer())
        .get(boundaryPath)
        .expect(404);
      expect(response.text).not.toContain(spaMarker);
    },
  );
});
