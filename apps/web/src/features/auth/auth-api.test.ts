import { HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { subscribeToAuthExpiry } from './auth-expiry';
import { authApi, type AuthSessionResponse } from './auth-api';

const requests: Array<[string, () => Promise<AuthSessionResponse>]> = [
  ['session restoration', () => authApi.session()],
  [
    'signup',
    () =>
      authApi.signUp({
        email: 'ada@example.com',
        name: 'Ada',
        password: 'Secure1!',
      }),
  ],
  [
    'signin',
    () =>
      authApi.signIn({
        email: 'ada@example.com',
        password: 'Secure1!',
      }),
  ],
];

afterEach(() => vi.restoreAllMocks());

describe('authApi authentication-failure policy', () => {
  it.each(requests)(
    'keeps a %s 401 local to its caller',
    async (_, request) => {
      const listener = vi.fn();
      const unsubscribe = subscribeToAuthExpiry(listener);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Invalid credentials',
            status: 401,
            code: 'INVALID_CREDENTIALS',
            requestId: 'req-auth',
          },
          { status: 401 },
        ),
      );

      try {
        await expect(request()).rejects.toMatchObject({
          status: 401,
          code: 'INVALID_CREDENTIALS',
        });
        expect(listener).not.toHaveBeenCalled();
        expect(fetchSpy.mock.calls[0]?.[1]).not.toHaveProperty(
          'authenticationFailure',
        );
      } finally {
        unsubscribe();
      }
    },
  );
});
