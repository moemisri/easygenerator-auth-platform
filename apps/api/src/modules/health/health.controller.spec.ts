import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE_HEALTH } from '../../platform/database/database.module';
import { REDIS } from '../../platform/redis/redis.constants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function createApp(
    mongodb: { ping(): Promise<unknown> } = { ping: async () => ({ ok: 1 }) },
    redis: { ping(): Promise<unknown> } = { ping: async () => 'PONG' },
  ) {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: DATABASE_HEALTH, useValue: mongodb },
        { provide: REDIS, useValue: redis },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    return app;
  }

  it('reports process liveness', () => {
    const health = new HealthService(
      { ping: async () => Promise.reject(new Error('not used')) },
      { ping: async () => Promise.reject(new Error('not used')) },
    );

    expect(new HealthController(health).live()).toEqual({ status: 'ok' });
  });

  it('serves liveness through the Nest HTTP route', async () => {
    await createApp();

    await request(app!.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
  });

  it('returns 200 with degraded readiness when only Redis fails', async () => {
    await createApp(undefined, {
      ping: async () => Promise.reject(new Error('Redis unavailable')),
    });

    await request(app!.getHttpServer())
      .get('/health/ready')
      .expect(200, {
        status: 'degraded',
        dependencies: { mongodb: 'up', redis: 'down' },
      });
  });

  it('returns 503 when MongoDB fails', async () => {
    await createApp(
      { ping: async () => Promise.reject(new Error('MongoDB unavailable')) },
      undefined,
    );

    await request(app!.getHttpServer())
      .get('/health/ready')
      .expect(503, {
        status: 'degraded',
        dependencies: { mongodb: 'down', redis: 'up' },
      });
  });
});
