import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { PrivacyKeyDigestService } from '../../platform/redis/privacy-key-digest.service';
import { REDIS } from '../../platform/redis/redis.constants';
import {
  assistantProtectionUnavailable,
  AssistantStreamInProgressError,
} from './assistant.errors';
import { assistantRedisNamespace } from './assistant-redis';

const LEASE_SECONDS = 35;
const compareAndDeleteScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export const ASSISTANT_LEASE_RANDOM_SOURCE = Symbol(
  'ASSISTANT_LEASE_RANDOM_SOURCE',
);

export interface AssistantLeaseRandomSource {
  token(): string;
}

export const assistantLeaseRandomSource: AssistantLeaseRandomSource = {
  token: () => randomBytes(32).toString('base64url'),
};

export interface AssistantLease {
  key: string;
  token: string;
}

@Injectable()
export class AssistantConcurrencyService {
  private readonly namespace: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
    @Inject(ASSISTANT_LEASE_RANDOM_SOURCE)
    private readonly random: AssistantLeaseRandomSource,
    private readonly privacyKeys: PrivacyKeyDigestService,
  ) {
    this.namespace = assistantRedisNamespace(config);
  }

  async acquire(userId: string): Promise<AssistantLease> {
    let lease: AssistantLease;
    let result: unknown;
    try {
      const actorDigest = this.privacyKeys.digest(
        'assistant:lease:actor',
        userId,
      );
      lease = {
        key: `${this.namespace}:active:${actorDigest}`,
        token: this.random.token(),
      };
      const setLease = this.redis.set.bind(this.redis) as unknown as (
        key: string,
        value: string,
        nx: 'NX',
        ex: 'EX',
        seconds: number,
      ) => Promise<unknown>;
      result = await setLease(
        lease.key,
        lease.token,
        'NX',
        'EX',
        LEASE_SECONDS,
      );
    } catch {
      throw assistantProtectionUnavailable();
    }
    if (result === null)
      throw new AssistantStreamInProgressError(LEASE_SECONDS);
    if (result !== 'OK') throw assistantProtectionUnavailable();
    return lease;
  }

  async release(lease: AssistantLease): Promise<void> {
    let result: unknown;
    try {
      result = await this.redis.eval(
        compareAndDeleteScript,
        1,
        lease.key,
        lease.token,
      );
    } catch {
      throw assistantProtectionUnavailable();
    }
    if (result !== 0 && result !== 1) {
      throw assistantProtectionUnavailable();
    }
  }
}
