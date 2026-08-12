import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { PrivacyKeyDigestService } from '../../platform/redis/privacy-key-digest.service';
import { AssistantRateLimiterService } from './assistant-rate-limiter.service';

const userDigest = 'tpH7Hjy-SG5Eyga-JjRYCpS32Ny2lEVt5x_D5rdGHeI';
const ipDigest = 'h7U1FcE3XxUi-ISIcFP5BShXfIjNZ7LRMXToipb4MRc';

function config(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === 'NODE_ENV') return 'test';
      if (key === 'IDENTITY_HASH_SECRET') {
        return Buffer.alloc(32, 9).toString('base64');
      }
      throw new Error(`Unexpected config key ${key}`);
    },
  } as ConfigService;
}

describe('AssistantRateLimiterService', () => {
  it('atomically enforces privacy-safe user, IP, and global budgets', async () => {
    const eval_ = vi.fn(() => Promise.resolve([10, 47, 30, 38, 100, 29]));
    const limiter = new AssistantRateLimiterService(
      { eval: eval_ } as unknown as Redis,
      config(),
      new PrivacyKeyDigestService(config()),
    );

    await expect(
      limiter.enforce('user-1', '192.0.2.10'),
    ).resolves.toBeUndefined();
    expect(eval_).toHaveBeenLastCalledWith(
      expect.any(String),
      3,
      `easygenerator:test:assistant:rate:user:${userDigest}`,
      `easygenerator:test:assistant:rate:ip:${ipDigest}`,
      'easygenerator:test:assistant:rate:global',
      10,
      60,
      30,
      60,
      100,
      60,
    );
    expect(JSON.stringify(eval_.mock.calls)).not.toContain('user-1');
    expect(JSON.stringify(eval_.mock.calls)).not.toContain('192.0.2.10');
  });

  it.each([
    ['user', [11, 47, 1, 38, 1, 29], 47],
    ['user at expiry boundary', [11, 0, 1, 38, 1, 29], 1],
    ['IP', [1, 47, 31, 38, 1, 29], 38],
    ['global', [1, 47, 1, 38, 101, 29], 29],
  ])(
    'rejects an exhausted %s budget with its Redis retry time',
    async (_budget, result, retryAfterSeconds) => {
      const limiter = new AssistantRateLimiterService(
        { eval: vi.fn(() => Promise.resolve(result)) } as unknown as Redis,
        config(),
        new PrivacyKeyDigestService(config()),
      );

      await expect(
        limiter.enforce('user-1', '192.0.2.10'),
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
        retryAfterSeconds,
      });
    },
  );

  it('uses the longest retry time when multiple budgets are exhausted', async () => {
    const limiter = new AssistantRateLimiterService(
      {
        eval: vi.fn(() => Promise.resolve([11, 12, 31, 47, 101, 29])),
      } as unknown as Redis,
      config(),
      new PrivacyKeyDigestService(config()),
    );

    await expect(limiter.enforce('user-1', '192.0.2.10')).rejects.toMatchObject(
      { retryAfterSeconds: 47 },
    );
  });

  it('does not charge IP or global capacity when an already-exhausted user is denied', async () => {
    const eval_ = vi.fn(() => Promise.resolve([1, 11, 47, 1, 38, 1, 29]));
    const limiter = new AssistantRateLimiterService(
      { eval: eval_ } as unknown as Redis,
      config(),
      new PrivacyKeyDigestService(config()),
    );

    await expect(limiter.enforce('user-1', '192.0.2.10')).rejects.toMatchObject(
      { code: 'RATE_LIMITED', retryAfterSeconds: 47 },
    );
    expect(eval_).toHaveBeenCalledWith(
      expect.stringContaining("tonumber(redis.call('GET', KEYS[index]))"),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      10,
      60,
      30,
      60,
      100,
      60,
    );
  });

  it.each([
    null,
    [],
    [1],
    [1, 60, 1, 60, 1],
    ['1', 60, 1, 60, 1, 60],
    [1, '60', 1, 60, 1, 60],
    [0, 60, 1, 60, 1, 60],
    [1, -1, 1, 60, 1, 60],
  ])('fails closed for an unexpected Redis result: %j', async (result) => {
    const limiter = new AssistantRateLimiterService(
      { eval: vi.fn(() => Promise.resolve(result)) } as unknown as Redis,
      config(),
      new PrivacyKeyDigestService(config()),
    );

    await expect(limiter.enforce('user-1', '192.0.2.10')).rejects.toMatchObject(
      {
        code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
        status: 503,
      },
    );
  });

  it('fails closed when the script rejects', async () => {
    const limiter = new AssistantRateLimiterService(
      {
        eval: vi.fn(() => Promise.reject(new Error('Redis unavailable'))),
      } as unknown as Redis,
      config(),
      new PrivacyKeyDigestService(config()),
    );

    await expect(limiter.enforce('user-1', '192.0.2.10')).rejects.toMatchObject(
      {
        code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
        status: 503,
      },
    );
  });

  it('fails closed without Redis access when principal digesting fails', async () => {
    const eval_ = vi.fn();
    const limiter = new AssistantRateLimiterService(
      { eval: eval_ } as unknown as Redis,
      config(),
      {
        digest: () => {
          throw new Error('digest unavailable');
        },
      } as unknown as PrivacyKeyDigestService,
    );

    await expect(limiter.enforce('user-1', '192.0.2.10')).rejects.toMatchObject(
      {
        code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
        status: 503,
      },
    );
    expect(eval_).not.toHaveBeenCalled();
  });
});
