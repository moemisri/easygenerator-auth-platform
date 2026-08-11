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
import { DatabaseIndexInitializer } from './platform/database/database-index-initializer';
import { ProblemDetailsFilter } from './platform/errors/problem-details.filter';
import { configureOpenApi } from './platform/http/openapi';
import { RequestIdMiddleware } from './platform/http/request-id.middleware';
import { ZodValidationPipe } from './platform/http/zod-validation.pipe';

type HelmetMiddleware = ReturnType<typeof helmet>;
type HelmetRequest = Parameters<HelmetMiddleware>[0] & { path: string };
type HelmetResponse = Parameters<HelmetMiddleware>[1];
type HelmetNext = Parameters<HelmetMiddleware>[2];

const strictContentSecurityPolicy = {
  directives: {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    scriptSrc: ["'self'"],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'"],
    styleSrcAttr: ["'none'"],
  },
} as const;

const documentationContentSecurityPolicy = {
  directives: {
    ...strictContentSecurityPolicy.directives,
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    styleSrcAttr: ["'unsafe-inline'"],
  },
} as const;

export function isOpenApiUiPath(path: string): boolean {
  const normalizedPath = path.toLowerCase();
  return (
    normalizedPath === '/api/docs' || normalizedPath.startsWith('/api/docs/')
  );
}

export function configureApplication(
  app: NestExpressApplication,
  config: Pick<AppConfig, 'TRUST_PROXY_HOPS'> &
    Partial<Pick<AppConfig, 'SWAGGER_ENABLED'>>,
  problemDetailsFilter: ProblemDetailsFilter,
): void {
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  const requestIds = new RequestIdMiddleware();
  app.use(requestIds.use.bind(requestIds));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '32kb' });
  const strictHelmet = helmet({
    contentSecurityPolicy: strictContentSecurityPolicy,
  });
  const documentationHelmet = helmet({
    contentSecurityPolicy: documentationContentSecurityPolicy,
  });
  app.use(
    (request: HelmetRequest, response: HelmetResponse, next: HelmetNext) =>
      (config.SWAGGER_ENABLED === true && isOpenApiUiPath(request.path)
        ? documentationHelmet
        : strictHelmet)(request, response, next),
  );
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(problemDetailsFilter);
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  configureOpenApi(app, config.SWAGGER_ENABLED ?? false);
  app.enableShutdownHooks();
}

interface StartupApplication {
  get(
    token: typeof DatabaseIndexInitializer,
  ): Pick<DatabaseIndexInitializer, 'ensureSecurityCriticalIndexes'>;
  init(): Promise<unknown>;
  listen(port: number): Promise<unknown>;
}

export async function initializeAndListen(
  app: StartupApplication,
  port: number,
): Promise<void> {
  await app.init();
  await app.get(DatabaseIndexInitializer).ensureSecurityCriticalIndexes();
  await app.listen(port);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  const config = app.get(ConfigService<AppConfig, true>);
  app.useLogger(app.get(Logger));
  configureApplication(
    app,
    {
      TRUST_PROXY_HOPS: config.get('TRUST_PROXY_HOPS', { infer: true }),
      SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
    },
    app.get(ProblemDetailsFilter),
  );
  await initializeAndListen(app, config.get('PORT', { infer: true }));
}

if (process.env.VITEST !== 'true') {
  void bootstrap();
}
