import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

import { REDIS } from './redis.constants.js';

const consumeFixedWindowScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiterService {
  private readonly namespace: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    const environment = config.getOrThrow<
      'development' | 'test' | 'production'
    >('NODE_ENV');
    this.namespace = `easygenerator:${environment}:rate-limit:`;
  }

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitDecision> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('limit must be a positive integer');
    }
    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
      throw new Error('windowSeconds must be a positive integer');
    }

    const result: unknown = await this.redis.eval(
      consumeFixedWindowScript,
      1,
      `${this.namespace}${key}`,
      limit,
      windowSeconds,
    );
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      !Number.isInteger(result[0]) ||
      !Number.isInteger(result[1]) ||
      (result[0] as number) < 1 ||
      (result[1] as number) < 0
    ) {
      throw new Error('Unexpected Redis rate-limit result');
    }

    const count = result[0];
    const ttl = result[1];
    const allowed = count <= limit;
    return {
      allowed,
      remaining: Math.max(limit - count, 0),
      retryAfterSeconds: allowed ? 0 : Math.max(ttl, 1),
    };
  }
}
