import { Controller, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

@Controller('wiring')
class WiringProbeController {
  @Post('probe')
  probe() {
    return { guarded: true };
  }
}

describe('AppModule platform wiring', () => {
  let app: NestExpressApplication | undefined;
  const originalEnvironment = process.env;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    process.env = originalEnvironment;
    vi.resetModules();
  });

  it('integrates config, Pino, guards, infrastructure, health, and shutdown', async () => {
    process.env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SERVE_STATIC_ASSETS: 'true',
    };
    vi.resetModules();

    const [
      { AppModule },
      { configureApplication },
      { DATABASE_HEALTH },
      { ProblemDetailsFilter },
      { REDIS },
    ] = await Promise.all([
      import('./app.module'),
      import('./main'),
      import('./platform/database/database.module'),
      import('./platform/errors/problem-details.filter'),
      import('./platform/redis/redis.constants'),
    ]);

    let mongoPings = 0;
    let mongoCloses = 0;
    const mongoModels: Record<string, unknown> = {};
    const mongoConnection = {
      db: {
        admin: () => ({
          ping: () => {
            mongoPings += 1;
            return Promise.resolve({ ok: 1 });
          },
        }),
      },
      close: () => {
        mongoCloses += 1;
        return Promise.resolve();
      },
      model: (name: string) => {
        const model = { modelName: name };
        mongoModels[name] = model;
        return model;
      },
      models: mongoModels,
    };
    let redisPings = 0;
    let redisQuits = 0;
    const redis = {
      ping: () => {
        redisPings += 1;
        return Promise.resolve('PONG' as const);
      },
      quit: () => {
        redisQuits += 1;
        return Promise.resolve('OK' as const);
      },
    };

    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [WiringProbeController],
    })
      .overrideProvider(getConnectionToken())
      .useValue(mongoConnection)
      .overrideProvider(REDIS)
      .useValue(redis)
      .compile();

    app = testingModule.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      bufferLogs: true,
    });
    const config = app.get(ConfigService);
    app.useLogger(app.get(Logger));
    configureApplication(
      app,
      { TRUST_PROXY_HOPS: config.getOrThrow<number>('TRUST_PROXY_HOPS') },
      app.get(ProblemDetailsFilter),
    );
    await app.init();

    expect(config.get('APP_ORIGIN')).toBe('http://localhost:5173');
    expect(config.get('SERVE_STATIC_ASSETS')).toBe(true);
    expect(app.get(Logger)).toBeInstanceOf(Logger);
    expect(await app.resolve(PinoLogger)).toBeInstanceOf(PinoLogger);
    expect(app.get(REDIS)).toBe(redis);
    await expect(
      app.get<{ ping(): Promise<unknown> }>(DATABASE_HEALTH).ping(),
    ).resolves.toEqual({ ok: 1 });

    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200, { status: 'ok' });
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200, {
        status: 'ok',
        dependencies: { mongodb: 'up', redis: 'up' },
      });
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(404);
    await request(app.getHttpServer()).post('/api/v1/wiring/probe').expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/wiring/probe')
      .set('Origin', 'http://localhost:5173')
      .expect(201, { guarded: true });
    await request(app.getHttpServer()).post('/wiring/probe').expect(404);

    expect(mongoPings).toBe(2);
    expect(redisPings).toBe(1);

    await app.close();
    app = undefined;
    expect(mongoCloses).toBe(1);
    expect(redisQuits).toBe(1);
  });
});
