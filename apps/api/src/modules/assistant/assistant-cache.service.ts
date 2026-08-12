import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

import { IDENTITY_HASH_SECRET } from '../auth/auth.constants.js';
import { REDIS } from '../../platform/redis/redis.constants.js';
import type {
  AssistantCorpus,
  CorpusChunk,
  RetrievedChunk,
} from './assistant.types.js';
import { assistantProtectionUnavailable } from './assistant.errors.js';
import { assistantRedisNamespace } from './assistant-redis.js';

const CACHE_TTL_SECONDS = 60 * 60;
const queryDomain = 'assistant-retrieval-query-v1\0';

@Injectable()
export class AssistantCacheService {
  private readonly namespace: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
    @Inject(IDENTITY_HASH_SECRET) private readonly identitySecret: Buffer,
  ) {
    this.namespace = assistantRedisNamespace(config);
  }

  async get(
    corpus: AssistantCorpus,
    normalizedQuery: string,
  ): Promise<CorpusChunk[] | null> {
    try {
      const value = await this.redis.get(
        this.cacheKey(corpus.digest, normalizedQuery),
      );
      if (value === null) return null;
      const parsed: unknown = JSON.parse(value);
      if (
        !Array.isArray(parsed) ||
        parsed.length > 4 ||
        parsed.some((id) => typeof id !== 'string') ||
        new Set(parsed).size !== parsed.length
      ) {
        throw assistantProtectionUnavailable();
      }
      const chunksById = new Map(
        corpus.chunks.map((chunk) => [chunk.id, chunk] as const),
      );
      const chunks = parsed.map((id) => chunksById.get(id));
      if (chunks.some((chunk) => chunk === undefined)) {
        throw assistantProtectionUnavailable();
      }
      return chunks as CorpusChunk[];
    } catch {
      throw assistantProtectionUnavailable();
    }
  }

  async set(
    corpus: AssistantCorpus,
    normalizedQuery: string,
    chunks: RetrievedChunk[],
  ): Promise<void> {
    try {
      const result = await this.redis.set(
        this.cacheKey(corpus.digest, normalizedQuery),
        JSON.stringify(chunks.map((chunk) => chunk.id)),
        'EX',
        CACHE_TTL_SECONDS,
      );
      if (result !== 'OK') throw assistantProtectionUnavailable();
    } catch {
      throw assistantProtectionUnavailable();
    }
  }

  private cacheKey(corpusDigest: string, normalizedQuery: string): string {
    const queryMac = createHmac('sha256', this.identitySecret)
      .update(queryDomain)
      .update(normalizedQuery)
      .digest('base64url');
    return `${this.namespace}:retrieval:${corpusDigest}:${queryMac}`;
  }
}
