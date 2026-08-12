import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import { AuditModule } from './modules/audit/audit.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AssistantModule } from './modules/assistant/assistant.module.js';
import { configuration } from './platform/config/configuration.js';
import { APP_ORIGIN, OriginGuard } from './platform/http/origin.guard.js';
import { SpaFallbackRegistrar } from './platform/http/spa-fallback.registrar.js';
import { LoggingModule } from './platform/logging/logging.module.js';
import {
  PROBLEM_LOGGER,
  ProblemDetailsFilter,
} from './platform/errors/problem-details.filter.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      ignoreEnvFile: true,
      isGlobal: true,
      validate: configuration,
    }),
    LoggingModule,
    AssistantModule,
    AdminModule,
    AuditModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_ORIGIN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('APP_ORIGIN'),
    },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: PROBLEM_LOGGER, useExisting: PinoLogger },
    ProblemDetailsFilter,
    SpaFallbackRegistrar,
  ],
})
export class AppModule {}
