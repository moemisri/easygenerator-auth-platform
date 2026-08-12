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
    mongodb: { ping(): Promise<unknown> } = {
      ping: () => Promise.resolve({ ok: 1 }),
    },
    redis: { ping(): Promise<unknown> } = {
      ping: () => Promise.resolve('PONG'),
    },
  ): Promise<INestApplication> {
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
    const createdApp = await createApp();

    const server = createdApp.getHttpServer() as Parameters<typeof request>[0];
    const response = await request(server).get('/health/live');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text) as unknown).toEqual({ status: 'ok' });
  });

  it('returns 503 when Redis fails', async () => {
    const createdApp = await createApp(undefined, {
      ping: async () => Promise.reject(new Error('Redis unavailable')),
    });

    const server = createdApp.getHttpServer() as Parameters<typeof request>[0];
    const response = await request(server).get('/health/ready');
    expect(response.status).toBe(503);
    expect(JSON.parse(response.text) as unknown).toEqual({
      status: 'degraded',
      dependencies: { mongodb: 'up', redis: 'down' },
    });
  });

  it('returns 503 when MongoDB fails', async () => {
    const createdApp = await createApp(
      { ping: async () => Promise.reject(new Error('MongoDB unavailable')) },
      undefined,
    );

    const server = createdApp.getHttpServer() as Parameters<typeof request>[0];
    const response = await request(server).get('/health/ready');
    expect(response.status).toBe(503);
    expect(JSON.parse(response.text) as unknown).toEqual({
      status: 'degraded',
      dependencies: { mongodb: 'down', redis: 'up' },
    });
  });
});
