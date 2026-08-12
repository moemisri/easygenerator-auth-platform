import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimiterService } from './rate-limiter.service';

describe('RateLimiterService', () => {
  let evalScript: ReturnType<typeof vi.fn>;
  let service: RateLimiterService;

  beforeEach(() => {
    evalScript = vi.fn();
    service = new RateLimiterService(
      { eval: evalScript } as unknown as Redis,
      {
        getOrThrow: (key: string) => {
          if (key === 'NODE_ENV') return 'test';
          throw new Error(`Unexpected config key: ${key}`);
        },
      } as unknown as ConfigService,
    );
  });

  it.each([
    ['test', 'easygenerator:test:rate-limit:'],
    ['development', 'easygenerator:development:rate-limit:'],
    ['production', 'easygenerator:production:rate-limit:'],
  ] as const)(
    'isolates the %s namespace',
    async (environment, expectedNamespace) => {
      evalScript.mockResolvedValue([1, 60]);
      const environmentService = new RateLimiterService(
        { eval: evalScript } as unknown as Redis,
        {
          getOrThrow: (key: string) => {
            if (key === 'NODE_ENV') return environment;
            throw new Error(`Unexpected config key: ${key}`);
          },
        } as unknown as ConfigService,
      );

      await environmentService.consume('feature:scope:digest', 5, 60);

      expect(evalScript).toHaveBeenCalledWith(
        expect.any(String),
        1,
        `${expectedNamespace}feature:scope:digest`,
        5,
        60,
      );
    },
  );

  it('returns the remaining fixed-window capacity from Redis', async () => {
    evalScript.mockResolvedValue([3, 712]);

    await expect(
      service.consume('feature:scope:opaque-digest', 10, 900),
    ).resolves.toEqual({ allowed: true, remaining: 7, retryAfterSeconds: 0 });
    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      1,
      'easygenerator:test:rate-limit:feature:scope:opaque-digest',
      10,
      900,
    );
  });

  it('charges multiple failed-authentication dimensions atomically', async () => {
    evalScript.mockResolvedValue([10, 900, 6, 900]);

    await expect(
      service.consumeMany([
        { key: 'signin:ip:digest', limit: 10, windowSeconds: 900 },
        { key: 'signin:identity:digest', limit: 5, windowSeconds: 900 },
      ]),
    ).resolves.toEqual([
      { allowed: true, remaining: 0, retryAfterSeconds: 0 },
      { allowed: false, remaining: 0, retryAfterSeconds: 900 },
    ]);
    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining('for index = 1, #KEYS do'),
      2,
      'easygenerator:test:rate-limit:signin:ip:digest',
      'easygenerator:test:rate-limit:signin:identity:digest',
      10,
      900,
      5,
      900,
    );
  });

  it('inspects a fixed window without incrementing it', async () => {
    evalScript.mockResolvedValue([4, 321]);

    await expect(service.inspect('signin:identity:digest', 5)).resolves.toEqual(
      {
        allowed: true,
        remaining: 1,
        retryAfterSeconds: 0,
      },
    );
    expect(evalScript).toHaveBeenCalledWith(
      expect.not.stringContaining("redis.call('INCR', KEYS[1])"),
      1,
      'easygenerator:test:rate-limit:signin:identity:digest',
      5,
    );
  });

  it('reports an exhausted inspected window without consuming more capacity', async () => {
    evalScript.mockResolvedValue([5, 233]);

    await expect(service.inspect('signin:identity:digest', 5)).resolves.toEqual(
      {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 233,
      },
    );
  });

  it('blocks after the limit and returns the current Redis TTL', async () => {
    evalScript.mockResolvedValue([6, 433]);

    await expect(
      service.consume('signin:identity:digest', 5, 900),
    ).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 433,
    });
  });

  it('uses at least one retry second if Redis reports an expiring boundary', async () => {
    evalScript.mockResolvedValue([11, 0]);

    await expect(
      service.consume('signin:ip:address', 10, 900),
    ).resolves.toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
  });

  it('propagates Redis failures for fail-closed callers to translate', async () => {
    evalScript.mockRejectedValue(new Error('connection closed'));

    await expect(service.consume('signup:ip:address', 5, 3600)).rejects.toThrow(
      'connection closed',
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid limit %s before calling Redis',
    async (limit) => {
      await expect(
        service.consume('feature:scope:opaque-digest', limit, 60),
      ).rejects.toThrow('limit must be a positive integer');
      expect(evalScript).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid window %s before calling Redis',
    async (windowSeconds) => {
      await expect(
        service.consume('feature:scope:opaque-digest', 5, windowSeconds),
      ).rejects.toThrow('windowSeconds must be a positive integer');
      expect(evalScript).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    [],
    [1],
    [1, 60, 7],
    ['1', 60],
    [1, '60'],
    [0, 60],
    [-1, 60],
    [1.5, 60],
    [Number.NaN, 60],
    [Number.POSITIVE_INFINITY, 60],
    [1, -1],
    [1, 1.5],
    [1, Number.NaN],
    [1, Number.POSITIVE_INFINITY],
  ])('rejects malformed Redis script result %j', async (result) => {
    evalScript.mockResolvedValue(result);

    await expect(
      service.consume('feature:scope:opaque-digest', 5, 3600),
    ).rejects.toThrow('Unexpected Redis rate-limit result');
  });
});
