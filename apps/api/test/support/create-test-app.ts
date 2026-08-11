import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import { Logger } from 'nestjs-pino';

import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/main';
import type { AppConfig } from '../../src/platform/config/config.schema';
import { ProblemDetailsFilter } from '../../src/platform/errors/problem-details.filter';

export async function createTestApp(): Promise<NestExpressApplication> {
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
    {
      TRUST_PROXY_HOPS: config.get('TRUST_PROXY_HOPS', { infer: true }),
    },
    app.get(ProblemDetailsFilter),
  );
  await app.init();

  const connection = app.get<Connection>(getConnectionToken());
  if (connection.name !== 'easygenerator_auth_test') {
    await app.close();
    throw new Error(`Refusing to test against database ${connection.name}`);
  }
  await connection.syncIndexes();
  return app;
}
