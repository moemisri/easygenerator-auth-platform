import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { configuration } from './platform/config/configuration';
import { APP_ORIGIN, OriginGuard } from './platform/http/origin.guard';
import { LoggingModule } from './platform/logging/logging.module';
import {
  PROBLEM_LOGGER,
  ProblemDetailsFilter,
} from './platform/errors/problem-details.filter';

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
  ],
})
export class AppModule {}
