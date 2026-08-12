import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

import { PrivacyKeyDigestService } from '../../platform/redis/privacy-key-digest.service.js';
import { REDIS } from '../../platform/redis/redis.constants.js';
import {
  AssistantRateLimitError,
  assistantProtectionUnavailable,
} from './assistant.errors.js';
import { assistantRedisNamespace } from './assistant-redis.js';

const ASSISTANT_USER_RATE_LIMIT = 10;
const ASSISTANT_IP_RATE_LIMIT = 30;
const ASSISTANT_GLOBAL_RATE_LIMIT = 100;
const ASSISTANT_RATE_WINDOW_SECONDS = 60;

const consumeFixedWindowScript = `
local counts = {}
local ttls = {}
local limits = {}
local windows = {}
for index = 1, #KEYS do
  local limit = tonumber(ARGV[(index - 1) * 2 + 1])
  local window = tonumber(ARGV[(index - 1) * 2 + 2])
  if not limit or limit < 1 or limit ~= math.floor(limit) or
     not window or window < 1 or window ~= math.floor(window) then
    return redis.error_reply('invalid assistant rate limit arguments')
  end
  limits[index] = limit
  windows[index] = window
end
local blocked = false
for index = 1, #KEYS do
  local count = tonumber(redis.call('GET', KEYS[index])) or 0
  local ttl = redis.call('TTL', KEYS[index])
  if ttl < 0 then ttl = 0 end
  counts[index] = count
  ttls[index] = ttl
  local limit = limits[index]
  if count >= limit then blocked = true end
end
if blocked then
  local result = {1}
  for index = 1, #KEYS do
    local limit = limits[index]
    table.insert(result, counts[index] >= limit and limit + 1 or math.max(counts[index], 1))
    table.insert(result, ttls[index])
  end
  return result
end
local result = {0}
for index = 1, #KEYS do
  local count = redis.call('INCR', KEYS[index])
  local window = windows[index]
  if count == 1 then redis.call('EXPIRE', KEYS[index], window) end
  local ttl = redis.call('TTL', KEYS[index])
  table.insert(result, count)
  table.insert(result, ttl)
end
return result
`;

@Injectable()
export class AssistantRateLimiterService {
  private readonly namespace: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
    private readonly privacyKeys: PrivacyKeyDigestService,
  ) {
    this.namespace = assistantRedisNamespace(config);
  }

  async enforce(userId: string, requestIp: string): Promise<void> {
    let result: unknown;
    try {
      const userDigest = this.privacyKeys.digest('assistant:rate:user', userId);
      const ipDigest = this.privacyKeys.digest('assistant:rate:ip', requestIp);
      result = await this.redis.eval(
        consumeFixedWindowScript,
        3,
        `${this.namespace}:rate:user:${userDigest}`,
        `${this.namespace}:rate:ip:${ipDigest}`,
        `${this.namespace}:rate:global`,
        ASSISTANT_USER_RATE_LIMIT,
        ASSISTANT_RATE_WINDOW_SECONDS,
        ASSISTANT_IP_RATE_LIMIT,
        ASSISTANT_RATE_WINDOW_SECONDS,
        ASSISTANT_GLOBAL_RATE_LIMIT,
        ASSISTANT_RATE_WINDOW_SECONDS,
      );
    } catch {
      throw assistantProtectionUnavailable();
    }
    if (
      !Array.isArray(result) ||
      (result.length !== 6 && result.length !== 7) ||
      result.some((value) => !Number.isInteger(value)) ||
      result.some((value, index) => {
        const offset = result.length === 7 ? 1 : 0;
        if (index === 0 && offset === 1) return value !== 0 && value !== 1;
        return (index - offset) % 2 === 0
          ? (value as number) < 1
          : (value as number) < 0;
      })
    ) {
      throw assistantProtectionUnavailable();
    }
    const offset = result.length === 7 ? 1 : 0;
    const [userCount, userTtl, ipCount, ipTtl, globalCount, globalTtl] =
      result.slice(offset) as [number, number, number, number, number, number];
    const exhaustedRetryTimes: number[] = [];
    if (userCount > ASSISTANT_USER_RATE_LIMIT)
      exhaustedRetryTimes.push(userTtl);
    if (ipCount > ASSISTANT_IP_RATE_LIMIT) exhaustedRetryTimes.push(ipTtl);
    if (globalCount > ASSISTANT_GLOBAL_RATE_LIMIT)
      exhaustedRetryTimes.push(globalTtl);
    if (exhaustedRetryTimes.length > 0) {
      throw new AssistantRateLimitError(Math.max(...exhaustedRetryTimes, 1));
    }
  }
}
