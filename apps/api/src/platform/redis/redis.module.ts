import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { REDIS } from './redis.constants.js';
import { PrivacyKeyDigestService } from './privacy-key-digest.service.js';
import { RateLimiterService } from './rate-limiter.service.js';

@Injectable()
export class RedisShutdown implements OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'end') return;
    await this.redis.quit();
  }
}

@Module({
  imports: [ConfigModule],
  providers: [
    PrivacyKeyDigestService,
    RateLimiterService,
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>('REDIS_URL'), {
          connectTimeout: 1_000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        }),
    },
    {
      provide: RedisShutdown,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisShutdown(redis),
    },
  ],
  exports: [REDIS, PrivacyKeyDigestService, RateLimiterService],
})
export class RedisModule {}
