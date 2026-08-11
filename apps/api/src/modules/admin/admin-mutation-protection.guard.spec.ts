import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrivacyKeyDigestService } from '../../platform/redis/privacy-key-digest.service';
import type { RateLimiterService } from '../../platform/redis/rate-limiter.service';
import { CsrfGuard } from '../auth/csrf.guard';
import { SessionGuard } from '../auth/session.guard';
import { AdminController } from './admin.controller';
import { AdminMutationProtectionGuard } from './admin-mutation-protection.guard';
import { CapabilityGuard } from './capability.guard';

const actorId = 'actor-sentinel-507f';
const trustedIp = '198.51.100.77';
const actorDigest = 'CuM-eHRXWDjnSEdGoZf6-_xZMTpe78NdZ_oOV4WlRhc';
const ipDigest = 'USaMswG82EQOsLqKWEh3dvu26yGb4JAQwdyRYEweBbM';

function context(principal = true): ExecutionContext {
  const request = {
    ip: trustedIp,
    ...(principal
      ? {
          principal: {
            sessionId: 'session-id',
            user: { id: actorId },
          },
        }
      : {}),
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

function realPrivacyKeys(): PrivacyKeyDigestService {
  return new PrivacyKeyDigestService({
    getOrThrow: (key: string) => {
      if (key === 'IDENTITY_HASH_SECRET') {
        return Buffer.alloc(32, 9).toString('base64');
      }
      throw new Error(`Unexpected config key: ${key}`);
    },
  } as ConfigService);
}

describe('AdminMutationProtectionGuard', () => {
  let consume: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    consume = vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 19,
      retryAfterSeconds: 0,
    });
  });

  it('runs after session, CSRF, and capability only on PATCH', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AdminController.prototype.update,
      ) as unknown,
    ).toEqual([
      SessionGuard,
      CsrfGuard,
      CapabilityGuard,
      AdminMutationProtectionGuard,
    ]);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        AdminController.prototype.list,
      ) as unknown,
    ).toEqual([SessionGuard, CapabilityGuard]);
  });

  it('consumes separate private actor and trusted-IP counters', async () => {
    const guard = new AdminMutationProtectionGuard(
      { consume } as unknown as RateLimiterService,
      realPrivacyKeys(),
    );

    await expect(guard.canActivate(context())).resolves.toBe(true);

    expect(consume.mock.calls).toEqual([
      [`admin-mutation:actor:${actorDigest}`, 20, 60],
      [`admin-mutation:ip:${ipDigest}`, 20, 60],
    ]);
    expect(JSON.stringify(consume.mock.calls)).not.toContain(actorId);
    expect(JSON.stringify(consume.mock.calls)).not.toContain(trustedIp);
  });

  it('returns the greatest blocked retry time', async () => {
    consume
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 13,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 47,
      });
    const guard = new AdminMutationProtectionGuard(
      { consume } as unknown as RateLimiterService,
      realPrivacyKeys(),
    );

    await expect(guard.canActivate(context())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 47,
    });
  });

  it('maps limiter rejection only to admin mutation protection unavailable', async () => {
    consume.mockRejectedValue(new Error('Redis connection closed'));
    const guard = new AdminMutationProtectionGuard(
      { consume } as unknown as RateLimiterService,
      realPrivacyKeys(),
    );

    await expect(guard.canActivate(context())).rejects.toMatchObject({
      code: 'ADMIN_MUTATION_PROTECTION_UNAVAILABLE',
      status: 503,
    });
  });

  it('maps digest rejection to the same 503 without consuming Redis', async () => {
    const digest = vi.fn((scope: string) => {
      if (scope === 'admin-mutation:ip') throw new Error('digest unavailable');
      return actorDigest;
    });
    const guard = new AdminMutationProtectionGuard(
      { consume } as unknown as RateLimiterService,
      { digest } as unknown as PrivacyKeyDigestService,
    );

    await expect(guard.canActivate(context())).rejects.toMatchObject({
      code: 'ADMIN_MUTATION_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it('preserves unauthenticated without digest or limiter access', async () => {
    const digest = vi.fn();
    const guard = new AdminMutationProtectionGuard(
      { consume } as unknown as RateLimiterService,
      { digest } as unknown as PrivacyKeyDigestService,
    );

    await expect(guard.canActivate(context(false))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    expect(digest).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });
});
