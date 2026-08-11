import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import { Logger } from 'nestjs-pino';

import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/main';
import { AuditService } from '../../src/modules/audit/audit.service';
import type { AppConfig } from '../../src/platform/config/config.schema';
import { ProblemDetailsFilter } from '../../src/platform/errors/problem-details.filter';

interface TestAppOverrides {
  auditService?: Pick<AuditService, 'record'>;
}

export async function createTestApp(
  overrides: TestAppOverrides = {},
): Promise<NestExpressApplication> {
  const testingModuleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });
  if (overrides.auditService !== undefined) {
    testingModuleBuilder
      .overrideProvider(AuditService)
      .useValue(overrides.auditService);
  }
  const testingModule = await testingModuleBuilder.compile();
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
