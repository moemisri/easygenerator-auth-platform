import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createConnection, type Connection } from 'mongoose';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/main';
import type { AppConfig } from '../../src/platform/config/config.schema';
import { DatabaseIndexInitializer } from '../../src/platform/database/database-index-initializer';
import { ProblemDetailsFilter } from '../../src/platform/errors/problem-details.filter';

const disposableDatabaseName = 'easygenerator_auth_test';
const localTestMongoPrefix = 'mongodb://127.0.0.1:27018/';
const appOrigin = 'http://localhost:5173';

async function dropDisposableTestDatabase(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (
    process.env.DB_NAME !== disposableDatabaseName ||
    mongoUri === undefined ||
    !mongoUri.startsWith(localTestMongoPrefix)
  ) {
    throw new Error('Refusing to drop a non-disposable MongoDB database');
  }

  const connection = await createConnection(mongoUri, {
    dbName: disposableDatabaseName,
  }).asPromise();
  try {
    if (connection.name !== disposableDatabaseName) {
      throw new Error(`Refusing to drop database ${connection.name}`);
    }
    await connection.dropDatabase();
  } finally {
    await connection.close();
  }
}

async function createListenerFreeApp(): Promise<NestExpressApplication> {
  const testingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = testingModule.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    bufferLogs: true,
  });
  const config = app.get(ConfigService<AppConfig, true>);
  app.useLogger(app.get(Logger));
  configureApplication(
    app,
    { TRUST_PROXY_HOPS: config.get('TRUST_PROXY_HOPS', { infer: true }) },
    app.get(ProblemDetailsFilter),
  );
  await app.init();

  const connection = app.get<Connection>(getConnectionToken());
  if (connection.name !== disposableDatabaseName) {
    await app.close();
    throw new Error(`Refusing to test against database ${connection.name}`);
  }
  return app;
}

describe('security-critical database index readiness', () => {
  let firstApp: NestExpressApplication;
  let secondApp: NestExpressApplication;

  beforeAll(async () => {
    await dropDisposableTestDatabase();
    [firstApp, secondApp] = await Promise.all([
      createListenerFreeApp(),
      createListenerFreeApp(),
    ]);
  });

  afterAll(async () => {
    await Promise.all([firstApp?.close(), secondApp?.close()]);
  });

  it('blocks a cold double-start until the unique normalized-email index is ready', async () => {
    expect(firstApp.getHttpServer().listening).toBe(false);
    expect(secondApp.getHttpServer().listening).toBe(false);

    await Promise.all([
      firstApp.get(DatabaseIndexInitializer).ensureSecurityCriticalIndexes(),
      secondApp.get(DatabaseIndexInitializer).ensureSecurityCriticalIndexes(),
    ]);

    expect(firstApp.getHttpServer().listening).toBe(false);
    expect(secondApp.getHttpServer().listening).toBe(false);

    const signup = {
      email: 'index-race@example.com',
      name: 'Index Race',
      password: 'Secure1!',
    };
    const responses = await Promise.all([
      request(firstApp.getHttpServer())
        .post('/api/v1/auth/signup')
        .set('Origin', appOrigin)
        .send(signup),
      request(secondApp.getHttpServer())
        .post('/api/v1/auth/signup')
        .set('Origin', appOrigin)
        .send({ ...signup, email: ' INDEX-RACE@EXAMPLE.COM ' }),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(responses.find(({ status }) => status === 409)?.body).toMatchObject({
      code: 'EMAIL_ALREADY_REGISTERED',
      status: 409,
    });

    const connection = firstApp.get<Connection>(getConnectionToken());
    const indexes = await connection.collection('users').indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { emailKey: 1 }, unique: true }),
    );
  });
});
