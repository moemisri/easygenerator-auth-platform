import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { RedisShutdown } from './redis.module';

describe('RedisShutdown', () => {
  it('gracefully quits an open client', async () => {
    const quit = vi.fn().mockResolvedValue('OK');

    await new RedisShutdown({
      status: 'ready',
      quit,
    } as unknown as Redis).onApplicationShutdown();

    expect(quit).toHaveBeenCalledOnce();
  });

  it('does not send QUIT after the client already ended', async () => {
    const quit = vi.fn().mockRejectedValue(new Error('Connection is closed'));

    await expect(
      new RedisShutdown({
        status: 'end',
        quit,
      } as unknown as Redis).onApplicationShutdown(),
    ).resolves.toBeUndefined();
    expect(quit).not.toHaveBeenCalled();
  });
});
