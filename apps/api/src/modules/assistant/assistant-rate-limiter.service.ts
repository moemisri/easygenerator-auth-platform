import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { REDIS } from '../../platform/redis/redis.constants';
import {
  AssistantRateLimitError,
  assistantProtectionUnavailable,
} from './assistant.errors';
import { assistantRedisNamespace } from './assistant-redis';

const ASSISTANT_RATE_LIMIT = 10;
const ASSISTANT_RATE_WINDOW_SECONDS = 60;

const consumeFixedWindowScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

@Injectable()
export class AssistantRateLimiterService {
  private readonly namespace: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.namespace = assistantRedisNamespace(config);
  }

  async enforce(userId: string): Promise<void> {
    let result: unknown;
    try {
      result = await this.redis.eval(
        consumeFixedWindowScript,
        1,
        `${this.namespace}:rate:${userId}`,
        ASSISTANT_RATE_LIMIT,
        ASSISTANT_RATE_WINDOW_SECONDS,
      );
    } catch {
      throw assistantProtectionUnavailable();
    }
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      !Number.isInteger(result[0]) ||
      !Number.isInteger(result[1]) ||
      (result[0] as number) < 1 ||
      (result[1] as number) < 0
    ) {
      throw assistantProtectionUnavailable();
    }
    const [count, ttl] = result as [number, number];
    if (count > ASSISTANT_RATE_LIMIT) {
      throw new AssistantRateLimitError(Math.max(ttl, 1));
    }
  }
}
