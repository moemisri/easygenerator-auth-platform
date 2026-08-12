import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { AssistantCorpus } from './assistant.types';
import { AssistantCacheService } from './assistant-cache.service';

const secret = Buffer.from('0123456789abcdef0123456789abcdef');
const corpus: AssistantCorpus = {
  digest: 'corpus-digest',
  chunks: [
    {
      id: 'chunk-a',
      file: 'overview.md',
      heading: 'Overview',
      content: '# Overview\nPublic facts.',
    },
    {
      id: 'chunk-b',
      file: 'authentication.md',
      heading: 'Sessions',
      content: '# Sessions\nServer-side sessions.',
    },
  ],
};

function config(environment = 'test'): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === 'NODE_ENV') return environment;
      throw new Error(`Unexpected config key ${key}`);
    },
  } as ConfigService;
}

function redisWith(overrides: Partial<Redis>): Redis {
  return overrides as Redis;
}

describe('AssistantCacheService', () => {
  it('uses the known domain-separated HMAC key rather than raw SHA-256', async () => {
    const get = vi.fn<(key: string) => Promise<string | null>>(() =>
      Promise.resolve(null),
    );
    const cache = new AssistantCacheService(
      redisWith({ get }),
      config(),
      secret,
    );

    await expect(cache.get(corpus, 'explain sessions')).resolves.toBeNull();

    expect(get).toHaveBeenCalledWith(
      'easygenerator:test:assistant:retrieval:corpus-digest:ASIH1-hVg_UH82Rs0h2pPxBVgmePpXhxLq5pmgNhus4',
    );
    expect(get.mock.calls[0]?.[0]).not.toContain('explain sessions');
    expect(get.mock.calls[0]?.[0]).not.toContain(
      'WlZxiZRH99tPAxIY1Fxo5VTKPpM5nSR8-TG9zmlXKGY',
    );
  });

  it('stores only chunk IDs for one hour', async () => {
    const set = vi.fn(() => Promise.resolve('OK' as const));
    const cache = new AssistantCacheService(
      redisWith({ set }),
      config(),
      secret,
    );

    await cache.set(corpus, 'explain sessions', [
      { ...corpus.chunks[1]!, coverage: 1 },
      { ...corpus.chunks[0]!, coverage: 0.5 },
    ]);

    expect(set).toHaveBeenCalledWith(
      expect.stringMatching(
        /^easygenerator:test:assistant:retrieval:corpus-digest:/,
      ),
      '["chunk-b","chunk-a"]',
      'EX',
      3_600,
    );
    expect(JSON.stringify(set.mock.calls)).not.toContain(
      'Server-side sessions',
    );
    expect(JSON.stringify(set.mock.calls)).not.toContain('Public facts');
  });

  it('rehydrates cached IDs only from the current corpus and preserves order', async () => {
    const cache = new AssistantCacheService(
      redisWith({
        get: vi.fn(() => Promise.resolve('["chunk-b","chunk-a"]')),
      }),
      config(),
      secret,
    );

    await expect(cache.get(corpus, 'explain sessions')).resolves.toEqual([
      corpus.chunks[1],
      corpus.chunks[0],
    ]);
  });

  it('fits cached excerpts to the same budget before returning corpus content', async () => {
    const oversizedCorpus: AssistantCorpus = {
      digest: 'oversized-corpus',
      chunks: [
        {
          id: 'oversized',
          file: 'overview.md',
          heading: 'Overview',
          content: `sessions ${'x'.repeat(12_100)}`,
        },
      ],
    };
    const cache = new AssistantCacheService(
      redisWith({
        get: vi.fn(() => Promise.resolve('["oversized"]')),
      }),
      config(),
      secret,
    );

    const chunks = await cache.get(oversizedCorpus, 'sessions');

    expect(chunks).toHaveLength(1);
    expect(chunks?.[0]?.content.length).toBeLessThanOrEqual(12_000);
  });

  it.each([
    ['malformed JSON', '{'],
    ['non-array JSON', '{}'],
    [
      'more than four IDs',
      '["chunk-a","chunk-a","chunk-a","chunk-a","chunk-a"]',
    ],
    ['duplicate IDs', '["chunk-a","chunk-a"]'],
    ['unknown ID', '["unknown"]'],
    ['non-string ID', '[1]'],
  ])('fails closed for %s', async (_case, value) => {
    const cache = new AssistantCacheService(
      redisWith({ get: vi.fn(() => Promise.resolve(value)) }),
      config(),
      secret,
    );

    await expect(cache.get(corpus, 'explain sessions')).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
  });

  it('fails closed when Redis rejects', async () => {
    const cache = new AssistantCacheService(
      redisWith({
        get: vi.fn(() =>
          Promise.reject(new Error('redis://private-host failed')),
        ),
      }),
      config('production'),
      secret,
    );

    await expect(cache.get(corpus, 'explain sessions')).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
  });
});
