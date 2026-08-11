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

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [BoundaryModule],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApplication(
      app,
      { TRUST_PROXY_HOPS: 1 },
      new ProblemDetailsFilter({ error: () => undefined }),
    );
    await app.init();
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
});
