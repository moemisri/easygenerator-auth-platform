import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { HealthModule } from './modules/health/health.module';
import { configuration } from './platform/config/configuration';
import { APP_ORIGIN, OriginGuard } from './platform/http/origin.guard';
import { LoggingModule } from './platform/logging/logging.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      ignoreEnvFile: true,
      isGlobal: true,
      validate: configuration,
    }),
    LoggingModule,
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
  ],
})
export class AppModule {}
