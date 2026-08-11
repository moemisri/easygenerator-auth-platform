import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { PrivacyKeyDigestService } from '../../platform/redis/privacy-key-digest.service';
import { AssistantRateLimiterService } from './assistant-rate-limiter.service';

const actorDigest = 'x7bw7nNi6O1Y5WvxFivvkuT2GNtf8_8Pbess3bUIwqE';

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
  it('allows request ten and rejects request eleven with Redis retry time', async () => {
    let count = 0;
    const eval_ = vi.fn(async () => {
      count += 1;
      return [count, 47];
    });
    const limiter = new AssistantRateLimiterService(
      { eval: eval_ } as unknown as Redis,
      config(),
      new PrivacyKeyDigestService(config()),
    );

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expect(limiter.enforce('user-1')).resolves.toBeUndefined();
    }
    await expect(limiter.enforce('user-1')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 47,
    });
    expect(eval_).toHaveBeenLastCalledWith(
      expect.any(String),
      1,
      `easygenerator:test:assistant:rate:${actorDigest}`,
      10,
      60,
    );
    expect(JSON.stringify(eval_.mock.calls)).not.toContain('user-1');
  });

  it.each([null, [], [1], ['1', 60], [1, '60'], [0, 60], [1, -1]])(
    'fails closed for an unexpected Redis result: %j',
    async (result) => {
      const limiter = new AssistantRateLimiterService(
        { eval: vi.fn(async () => result) } as unknown as Redis,
        config(),
        new PrivacyKeyDigestService(config()),
      );

      await expect(limiter.enforce('user-1')).rejects.toMatchObject({
        code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
        status: 503,
      });
    },
  );

  it('fails closed when the script rejects', async () => {
    const limiter = new AssistantRateLimiterService(
      {
        eval: vi.fn(async () => {
          throw new Error('Redis unavailable');
        }),
      } as unknown as Redis,
      config(),
      new PrivacyKeyDigestService(config()),
    );

    await expect(limiter.enforce('user-1')).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
  });

  it('fails closed without Redis access when actor digesting fails', async () => {
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

    await expect(limiter.enforce('user-1')).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    expect(eval_).not.toHaveBeenCalled();
  });
});
