import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { PrivacyKeyDigestService } from './privacy-key-digest.service';

const secret = Buffer.alloc(32, 9).toString('base64');

function service(): PrivacyKeyDigestService {
  return new PrivacyKeyDigestService({
    getOrThrow: (key: string) => {
      if (key === 'IDENTITY_HASH_SECRET') return secret;
      throw new Error(`Unexpected config key: ${key}`);
    },
  } as ConfigService);
}

describe('PrivacyKeyDigestService', () => {
  it('returns stable Base64URL HMACs without actor or IP input', () => {
    const digests = service();
    const actorSentinel = 'actor-sentinel-507f';
    const ipSentinel = '198.51.100.77';

    const actorDigest = digests.digest('admin-mutation:actor', actorSentinel);
    const ipDigest = digests.digest('admin-mutation:ip', ipSentinel);

    expect(actorDigest).toBe('CuM-eHRXWDjnSEdGoZf6-_xZMTpe78NdZ_oOV4WlRhc');
    expect(ipDigest).toBe('USaMswG82EQOsLqKWEh3dvu26yGb4JAQwdyRYEweBbM');
    expect(actorDigest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ipDigest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(actorDigest).not.toContain(actorSentinel);
    expect(ipDigest).not.toContain(ipSentinel);
  });

  it('changes when either scope or value changes', () => {
    const digests = service();
    const original = digests.digest('assistant:rate:actor', 'actor-a');

    expect(digests.digest('assistant:lease:actor', 'actor-a')).not.toBe(
      original,
    );
    expect(digests.digest('assistant:rate:actor', 'actor-b')).not.toBe(
      original,
    );
  });

  it('uses NUL domain separation to distinguish ambiguous concatenations', () => {
    const digests = service();

    expect(digests.digest('ab', 'c')).toBe(
      'SFPKfODLteVtu_YijlfG0h3xCOBDShsAfvThkyJoVFM',
    );
    expect(digests.digest('a', 'bc')).toBe(
      'X3kBd48E_CF8IrbJ8yKm6NcakpzlIip36te1JmXY314',
    );
    expect(digests.digest('ab', 'c')).not.toBe(digests.digest('a', 'bc'));
  });
});
