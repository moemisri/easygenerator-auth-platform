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

const inspectFixedWindowScript = `
local count = tonumber(redis.call('GET', KEYS[1])) or 0
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then ttl = 0 end
return {count, ttl}
`;

const consumeManyFixedWindowScript = `
local result = {}
for index = 1, #KEYS do
  local count = redis.call('INCR', KEYS[index])
  local window = ARGV[(index - 1) * 2 + 2]
  if count == 1 then redis.call('EXPIRE', KEYS[index], window) end
  local ttl = redis.call('TTL', KEYS[index])
  table.insert(result, count)
  table.insert(result, ttl)
end
return result
`;

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitWindow {
  key: string;
  limit: number;
  windowSeconds: number;
}

function parseRedisDecision(
  result: unknown,
  minimumCount: number,
): readonly [number, number] {
  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error('Unexpected Redis rate-limit result');
  }
  const candidate: unknown[] = result;
  const count: unknown = candidate[0];
  const ttl: unknown = candidate[1];
  if (
    typeof count !== 'number' ||
    typeof ttl !== 'number' ||
    !Number.isInteger(count) ||
    !Number.isInteger(ttl) ||
    count < minimumCount ||
    ttl < 0
  ) {
    throw new Error('Unexpected Redis rate-limit result');
  }
  return [count, ttl];
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
    this.validateLimit(limit);
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
    const [count, ttl] = parseRedisDecision(result, 1);
    const allowed = count <= limit;
    return {
      allowed,
      remaining: Math.max(limit - count, 0),
      retryAfterSeconds: allowed ? 0 : Math.max(ttl, 1),
    };
  }

  async inspect(key: string, limit: number): Promise<RateLimitDecision> {
    this.validateLimit(limit);
    const result: unknown = await this.redis.eval(
      inspectFixedWindowScript,
      1,
      `${this.namespace}${key}`,
      limit,
    );
    const [count, ttl] = parseRedisDecision(result, 0);
    const allowed = count < limit;
    return {
      allowed,
      remaining: Math.max(limit - count, 0),
      retryAfterSeconds: allowed ? 0 : Math.max(ttl, 1),
    };
  }

  async consumeMany(
    windows: readonly RateLimitWindow[],
  ): Promise<RateLimitDecision[]> {
    if (windows.length === 0)
      throw new Error('at least one window is required');
    const arguments_: (string | number)[] = [];
    for (const window of windows) {
      this.validateLimit(window.limit);
      if (
        !Number.isInteger(window.windowSeconds) ||
        window.windowSeconds <= 0
      ) {
        throw new Error('windowSeconds must be a positive integer');
      }
      arguments_.push(window.limit, window.windowSeconds);
    }
    const result: unknown = await this.redis.eval(
      consumeManyFixedWindowScript,
      windows.length,
      ...windows.map((window) => `${this.namespace}${window.key}`),
      ...arguments_,
    );
    if (!Array.isArray(result) || result.length !== windows.length * 2) {
      throw new Error('Unexpected Redis rate-limit result');
    }
    return windows.map((window, index) => {
      const [count, ttl] = parseRedisDecision(
        [result[index * 2], result[index * 2 + 1]],
        1,
      );
      const allowed = count <= window.limit;
      return {
        allowed,
        remaining: Math.max(window.limit - count, 0),
        retryAfterSeconds: allowed ? 0 : Math.max(ttl, 1),
      };
    });
  }

  private validateLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('limit must be a positive integer');
    }
  }
}
