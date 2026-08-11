import { describe, expect, it, vi } from 'vitest';

import { publishAuthExpiry, subscribeToAuthExpiry } from './auth-expiry';

describe('auth expiry events', () => {
  it('notifies each subscribed listener and stops after unsubscribe', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToAuthExpiry(first);
    const unsubscribeSecond = subscribeToAuthExpiry(second);

    try {
      publishAuthExpiry();
      unsubscribeFirst();
      publishAuthExpiry();

      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  it('uses a listener snapshot when a listener removes itself', () => {
    const delivered: string[] = [];
    let unsubscribeFirst: () => void = () => undefined;
    unsubscribeFirst = subscribeToAuthExpiry(() => {
      delivered.push('first');
      unsubscribeFirst();
    });
    const unsubscribeSecond = subscribeToAuthExpiry(() =>
      delivered.push('second'),
    );

    try {
      publishAuthExpiry();

      expect(delivered).toEqual(['first', 'second']);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  it('isolates listener failures from publication and later listeners', () => {
    const later = vi.fn();
    const unsubscribeThrowing = subscribeToAuthExpiry(() => {
      throw new Error('listener failed');
    });
    const unsubscribeLater = subscribeToAuthExpiry(later);

    try {
      expect(() => publishAuthExpiry()).not.toThrow();
      expect(later).toHaveBeenCalledOnce();
    } finally {
      unsubscribeThrowing();
      unsubscribeLater();
    }
  });
});
