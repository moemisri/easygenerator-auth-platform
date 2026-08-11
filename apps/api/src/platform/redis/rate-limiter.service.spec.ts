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

  it('returns the remaining fixed-window capacity from Redis', async () => {
    evalScript.mockResolvedValue([3, 712]);

    await expect(
      service.consume('signin:ip:203.0.113.9', 10, 900),
    ).resolves.toEqual({ allowed: true, remaining: 7, retryAfterSeconds: 0 });
    expect(evalScript).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'easygenerator:test:auth-rate-limit:signin:ip:203.0.113.9',
      10,
      900,
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

  it('rejects malformed Redis script results', async () => {
    evalScript.mockResolvedValue(['not-a-count']);

    await expect(service.consume('signup:ip:address', 5, 3600)).rejects.toThrow(
      'Unexpected Redis rate-limit result',
    );
  });
});
