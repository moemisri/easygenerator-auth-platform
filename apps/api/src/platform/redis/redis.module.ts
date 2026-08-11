import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { REDIS } from './redis.constants';
import { PrivacyKeyDigestService } from './privacy-key-digest.service';
import { RateLimiterService } from './rate-limiter.service';

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

  onApplicationShutdown(): void {
    this.redis.disconnect();
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
