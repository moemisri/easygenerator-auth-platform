import { authSessionResponseSchema } from '@easygenerator/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
