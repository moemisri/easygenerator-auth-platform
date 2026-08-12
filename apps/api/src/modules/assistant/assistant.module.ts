import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IDENTITY_HASH_SECRET } from '../auth/auth.constants.js';
import { LoggingModule } from '../../platform/logging/logging.module.js';
import { RedisModule } from '../../platform/redis/redis.module.js';
import { AssistantCacheService } from './assistant-cache.service.js';
import {
  ASSISTANT_LEASE_RANDOM_SOURCE,
  AssistantConcurrencyService,
  assistantLeaseRandomSource,
} from './assistant-concurrency.service.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantRateLimiterService } from './assistant-rate-limiter.service.js';
import {
  ASSISTANT_DEADLINE_MILLISECONDS,
  ASSISTANT_LEASE_RENEWAL_MILLISECONDS,
  AssistantService,
} from './assistant.service.js';
import { ASSISTANT_PROVIDER } from './assistant.types.js';
import {
  ASSISTANT_CORPUS_FILE_SYSTEM,
  ASSISTANT_CORPUS_ROOT,
  assistantCorpusFileSystem,
  DocumentLoaderService,
} from './document-loader.service.js';
import {
  GeminiProvider,
  GOOGLE_GENAI_FACTORY,
  googleGenAiFactory,
} from './gemini.provider.js';
import { RetrieverService } from './retriever.service.js';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);

@Module({
  imports: [ConfigModule, AuditModule, AuthModule, LoggingModule, RedisModule],
  controllers: [AssistantController],
  providers: [
    AssistantCacheService,
    AssistantConcurrencyService,
    AssistantRateLimiterService,
    AssistantService,
    DocumentLoaderService,
    GeminiProvider,
    RetrieverService,
    {
      provide: ASSISTANT_CORPUS_ROOT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        path.resolve(
          repositoryRoot,
          config.getOrThrow<string>('ASSISTANT_CORPUS_PATH'),
        ),
    },
    {
      provide: ASSISTANT_CORPUS_FILE_SYSTEM,
      useValue: assistantCorpusFileSystem,
    },
    {
      provide: ASSISTANT_LEASE_RANDOM_SOURCE,
      useValue: assistantLeaseRandomSource,
    },
    { provide: GOOGLE_GENAI_FACTORY, useValue: googleGenAiFactory },
    { provide: ASSISTANT_PROVIDER, useExisting: GeminiProvider },
    { provide: ASSISTANT_DEADLINE_MILLISECONDS, useValue: 30_000 },
    { provide: ASSISTANT_LEASE_RENEWAL_MILLISECONDS, useValue: 10_000 },
    {
      provide: IDENTITY_HASH_SECRET,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        Buffer.from(
          config.getOrThrow<string>('IDENTITY_HASH_SECRET'),
          'base64',
        ),
    },
  ],
  exports: [AssistantConcurrencyService],
})
export class AssistantModule {}
