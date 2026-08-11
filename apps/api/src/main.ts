import 'reflect-metadata';

import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import type { AppConfig } from './platform/config/config.schema';
import { ProblemDetailsFilter } from './platform/errors/problem-details.filter';
import { RequestIdMiddleware } from './platform/http/request-id.middleware';
import { ZodValidationPipe } from './platform/http/zod-validation.pipe';

export function configureApplication(
  app: NestExpressApplication,
  config: Pick<AppConfig, 'TRUST_PROXY_HOPS'>,
): void {
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  const requestIds = new RequestIdMiddleware();
  app.use(requestIds.use.bind(requestIds));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '32kb' });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  const config = app.get(ConfigService<AppConfig, true>);
  app.useLogger(app.get(Logger));
  configureApplication(app, {
    TRUST_PROXY_HOPS: config.get('TRUST_PROXY_HOPS', { infer: true }),
  });
  await app.listen(config.get('PORT', { infer: true }));
}

if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
  void bootstrap();
}
