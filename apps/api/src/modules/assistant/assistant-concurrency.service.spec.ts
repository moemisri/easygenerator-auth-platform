import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { PrivacyKeyDigestService } from '../../platform/redis/privacy-key-digest.service';
import {
  AssistantConcurrencyService,
  type AssistantLeaseRandomSource,
} from './assistant-concurrency.service';

const actorDigest = 'M6To1MuG1VkKSKaOKnbusSS5COHv2SUumJWam58z708';

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

const random: AssistantLeaseRandomSource = {
  token: vi.fn(() => 'lease-token-a'),
};

describe('AssistantConcurrencyService', () => {
  it('acquires a 35-second NX lease', async () => {
    const set = vi.fn(async () => 'OK' as const);
    const leases = new AssistantConcurrencyService(
      { set } as unknown as Redis,
      config(),
      random,
      new PrivacyKeyDigestService(config()),
    );

    const lease = await leases.acquire('user-1');

    expect(lease).toEqual({
      key: `easygenerator:test:assistant:active:${actorDigest}`,
      token: 'lease-token-a',
    });
    expect(set).toHaveBeenCalledWith(
      `easygenerator:test:assistant:active:${actorDigest}`,
      'lease-token-a',
      'NX',
      'EX',
      35,
    );
    expect(JSON.stringify(set.mock.calls)).not.toContain('user-1');
  });

  it('returns a stable 429 with Retry-After when the lease is held', async () => {
    const leases = new AssistantConcurrencyService(
      { set: vi.fn(async () => null) } as unknown as Redis,
      config(),
      random,
      new PrivacyKeyDigestService(config()),
    );

    await expect(leases.acquire('user-1')).rejects.toMatchObject({
      code: 'ASSISTANT_STREAM_IN_PROGRESS',
      status: 429,
      retryAfterSeconds: 35,
    });
  });

  it('releases only through compare-and-delete with the owning token', async () => {
    const eval_ = vi.fn(async () => 1);
    const leases = new AssistantConcurrencyService(
      { eval: eval_ } as unknown as Redis,
      config(),
      random,
      new PrivacyKeyDigestService(config()),
    );

    await leases.release({
      key: `easygenerator:test:assistant:active:${actorDigest}`,
      token: 'lease-token-a',
    });

    expect(eval_).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', KEYS[1])"),
      1,
      `easygenerator:test:assistant:active:${actorDigest}`,
      'lease-token-a',
    );
  });

  it.each([null, 'OK', 2, -1])(
    'fails closed for a malformed lease release result: %j',
    async (result) => {
      const leases = new AssistantConcurrencyService(
        { eval: vi.fn(async () => result) } as unknown as Redis,
        config(),
        random,
        new PrivacyKeyDigestService(config()),
      );

      await expect(
        leases.release({ key: 'safe-key', token: 'safe-token' }),
      ).rejects.toMatchObject({
        code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
        status: 503,
      });
    },
  );

  it('fails closed when acquisition rejects', async () => {
    const leases = new AssistantConcurrencyService(
      {
        set: vi.fn(async () => {
          throw new Error('Redis unavailable');
        }),
      } as unknown as Redis,
      config(),
      random,
      new PrivacyKeyDigestService(config()),
    );

    await expect(leases.acquire('user-1')).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
  });

  it('fails closed without Redis access when actor digesting fails', async () => {
    const set = vi.fn();
    const leases = new AssistantConcurrencyService(
      { set } as unknown as Redis,
      config(),
      random,
      {
        digest: () => {
          throw new Error('digest unavailable');
        },
      } as unknown as PrivacyKeyDigestService,
    );

    await expect(leases.acquire('user-1')).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    expect(set).not.toHaveBeenCalled();
  });
});
