import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spaStaticOptions } from '../../app.module.js';
import { configureApplication } from '../../main.js';
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
      imports: [ServeStaticModule.forRoot(spaStaticOptions(fixtureRoot))],
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
});
