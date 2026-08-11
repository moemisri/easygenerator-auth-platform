import { authSessionResponseSchema } from '@easygenerator/contracts';
import { HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { subscribeToAuthExpiry } from '../features/auth/auth-expiry';
import { ApiProblem, apiClient } from './api-client';

describe('apiClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses same-origin credentials and maps problem details', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Unauthenticated',
          status: 401,
          code: 'UNAUTHENTICATED',
          requestId: 'req-1',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );

    await expect(
      apiClient.request('/api/v1/auth/session', authSessionResponseSchema),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      requestId: 'req-1',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/auth/session',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('preserves validated problem detail context for form feedback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'https://example.test/problems/invalid-input',
          title: 'Invalid input',
          status: 400,
          detail: 'Use a valid email address.',
          instance: '/api/v1/auth/signup',
          code: 'VALIDATION_FAILED',
          requestId: 'req-2',
          fields: [{ field: 'email', message: 'Enter a valid email address.' }],
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );

    await expect(
      apiClient.request('/api/v1/auth/signup', authSessionResponseSchema),
    ).rejects.toMatchObject({
      detail: 'Use a valid email address.',
      instance: '/api/v1/auth/signup',
      fields: [{ field: 'email', message: 'Enter a valid email address.' }],
    });
  });

  it('rejects an invalid successful response rather than trusting malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    );
    await expect(
      apiClient.request('/ok', authSessionResponseSchema),
    ).rejects.toBeInstanceOf(ApiProblem);
  });

  it('turns a non-JSON failure into a safe problem', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('gateway unavailable', { status: 503 }),
    );
    await expect(
      apiClient.request('/outage', authSessionResponseSchema),
    ).rejects.toMatchObject({ status: 503, title: 'Request failed' });
  });

  it('only includes a CSRF header for an authenticated mutation', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await apiClient.request('/api/v1/auth/logout', undefined, {
      method: 'POST',
      csrfToken: 'token',
    });
    expect(
      new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('X-CSRF-Token'),
    ).toBe('token');
  });

  it('omits CSRF headers from reads and anonymous mutations', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await apiClient.request('/api/v1/auth/session', undefined, {
      csrfToken: 'token',
    });
    await apiClient.request('/api/v1/auth/signin', undefined, {
      method: 'POST',
    });
    expect(
      new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).has('X-CSRF-Token'),
    ).toBe(false);
    expect(
      new Headers(fetchSpy.mock.calls[1]?.[1]?.headers).has('X-CSRF-Token'),
    ).toBe(false);
  });

  it('does not retry a failed sign-in mutation', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('no', { status: 401 }));
    await expect(
      apiClient.request('/api/v1/auth/signin', authSessionResponseSchema, {
        method: 'POST',
        body: { email: 'ada@example.com' },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('publishes a protected 401 before rejecting with its parsed problem', async () => {
    const order: Array<'expiry' | ApiProblem> = [];
    const unsubscribe = subscribeToAuthExpiry(() => order.push('expiry'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Unauthenticated',
          status: 401,
          code: 'UNAUTHENTICATED',
          requestId: 'req-admin',
        },
        { status: 401 },
      ),
    );

    try {
      const problem = await apiClient
        .request('/api/v1/admin/users', undefined)
        .catch((error: ApiProblem) => {
          order.push(error);
          return error;
        });

      expect(problem).toMatchObject({
        status: 401,
        code: 'UNAUTHENTICATED',
        requestId: 'req-admin',
      });
      expect(order).toEqual(['expiry', problem]);
    } finally {
      unsubscribe();
    }
  });

  it('keeps form or restoration 401s local', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAuthExpiry(listener);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Invalid credentials',
          status: 401,
          code: 'INVALID_CREDENTIALS',
          requestId: 'req-signin',
        },
        { status: 401 },
      ),
    );

    try {
      await expect(
        apiClient.request('/api/v1/auth/signin', undefined, {
          authenticationFailure: 'form-or-restoration',
          method: 'POST',
        }),
      ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });

      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('strips the internal authentication-failure policy from fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await apiClient.request('/api/v1/auth/signin', undefined, {
      authenticationFailure: 'form-or-restoration',
      method: 'POST',
    });

    expect(fetchSpy.mock.calls[0]?.[1]).not.toHaveProperty(
      'authenticationFailure',
    );
  });
});
