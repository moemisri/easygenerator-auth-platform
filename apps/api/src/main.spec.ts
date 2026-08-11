import { Body, Controller, Get, Module, Post, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureApplication } from './main';
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
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(404);
    await request(app.getHttpServer()).get('/boundary').expect(404);
    await request(app.getHttpServer()).get('/api/v1/boundary').expect(200);
  });

  it('uses a server-owned request ID, trusted proxy hops, cookies, and Helmet', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/boundary')
      .set('Cookie', 'theme=dark')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('X-Request-Id', 'attacker-controlled')
      .expect(200);

    expect(response.body).toMatchObject({
      cookies: { theme: 'dark' },
      ip: '203.0.113.9',
    });
    expect(response.body.id).not.toBe('attacker-controlled');
    expect(response.headers['x-request-id']).toBe(response.body.id);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(response.headers).not.toHaveProperty('access-control-allow-origin');
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
