import { timingSafeEqual } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { CsrfService, type DigestComparator } from './csrf.service';

describe('CsrfService', () => {
  const secret = Buffer.alloc(32, 7);

  it('issues the expected HMAC-SHA-256 token for the raw session token', () => {
    const service = new CsrfService(secret, timingSafeEqual);

    expect(service.issue('session-a')).toBe(
      'RyoE9C41DYsaRALm6kltTE9kMjpW9Hj5t1OVwtpZ9wc',
    );
  });

  it('binds a CSRF token to one raw session token', () => {
    const service = new CsrfService(secret, timingSafeEqual);
    const csrf = service.issue('session-a');

    expect(service.verify('session-a', csrf)).toBe(true);
    expect(service.verify('session-b', csrf)).toBe(false);
  });

  it('rejects unequal lengths before constant-time comparison', () => {
    const compare = vi.fn<DigestComparator>(timingSafeEqual);
    const service = new CsrfService(secret, compare);

    expect(service.verify('session-a', 'short')).toBe(false);
    expect(compare).not.toHaveBeenCalled();
  });

  it('uses constant-time comparison for an equal-length mismatch', () => {
    const compare = vi.fn<DigestComparator>(timingSafeEqual);
    const service = new CsrfService(secret, compare);
    const csrf = service.issue('session-a');
    const tampered = `${csrf.slice(0, -1)}${csrf.endsWith('a') ? 'b' : 'a'}`;

    expect(service.verify('session-a', tampered)).toBe(false);
    expect(compare).toHaveBeenCalledOnce();
    const [expected, received] = compare.mock.calls[0] ?? [];
    expect(expected).toHaveLength(received?.length ?? -1);
  });
});
