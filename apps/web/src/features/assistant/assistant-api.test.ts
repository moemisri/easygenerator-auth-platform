import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiProblem } from '../../lib/api-client';
import { server } from '../../test/server';
import { AssistantProtocolError } from './parse-event-stream';
import { openAssistantStream } from './assistant-api';

const csrfToken = 'c'.repeat(32);

afterEach(() => vi.restoreAllMocks());

describe('openAssistantStream', () => {
  it('sends the exact bounded request through an authenticated same-origin POST', async () => {
    let observed:
      | {
          body: unknown;
          contentType: string | null;
          credentials: RequestCredentials;
          csrf: string | null;
          method: string;
          pathname: string;
          search: string;
        }
      | undefined;
    server.use(
      http.post('/api/v1/assistant/chat', async ({ request }) => {
        const url = new URL(request.url);
        observed = {
          body: await request.json(),
          contentType: request.headers.get('Content-Type'),
          credentials: request.credentials,
          csrf: request.headers.get('X-CSRF-Token'),
          method: request.method,
          pathname: url.pathname,
          search: url.search,
        };
        return new HttpResponse(
          'event: error\ndata: {"code":"ASSISTANT_TIMEOUT","message":"Timed out."}\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );

    await openAssistantStream(
      {
        message: '  How do sessions work?  ',
        history: [{ role: 'user', content: '  Earlier question  ' }],
      },
      csrfToken,
      new AbortController().signal,
    );

    expect(observed).toEqual({
      body: {
        message: 'How do sessions work?',
        history: [{ role: 'user', content: 'Earlier question' }],
      },
      contentType: 'application/json',
      credentials: 'include',
      csrf: csrfToken,
      method: 'POST',
      pathname: '/api/v1/assistant/chat',
      search: '',
    });
  });

  it('does not issue a request when the shared request schema rejects the input', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      openAssistantStream(
        { message: 'x'.repeat(1_001), history: [] },
        csrfToken,
        new AbortController().signal,
      ),
    ).rejects.toBeDefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('propagates the supplied abort signal to fetch', async () => {
    const controller = new AbortController();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_input, init) => {
        expect(init?.signal).toBe(controller.signal);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      });

    const pending = openAssistantStream(
      { message: 'How does logout work?', history: [] },
      csrfToken,
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it.each([
    ['ASSISTANT_DISABLED', 404, undefined],
    ['ASSISTANT_RATE_LIMITED', 429, 17],
    ['ASSISTANT_BUSY', 429, 300],
    ['SERVICE_UNAVAILABLE', 503, undefined],
  ])(
    'maps a pre-stream %s problem without attempting to parse SSE',
    async (code, status, expectedRetryAfter) => {
      server.use(
        http.post('/api/v1/assistant/chat', () =>
          HttpResponse.json(
            {
              type: 'https://example.com/problems/assistant',
              title: 'Safe title',
              status,
              detail: 'Safe detail.',
              code,
              requestId: 'req-assistant',
            },
            status === 429
              ? {
                  status,
                  headers: {
                    'Retry-After': code === 'ASSISTANT_BUSY' ? '9999' : '17',
                  },
                }
              : { status },
          ),
        ),
      );

      const error = await openAssistantStream(
        { message: 'How does authentication work?', history: [] },
        csrfToken,
        new AbortController().signal,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ApiProblem);
      expect(error).toMatchObject({
        status,
        code,
        requestId: 'req-assistant',
        detail: 'Safe detail.',
        retryAfter: expectedRetryAfter,
      });
    },
  );

  it.each([
    [
      'a malformed problem response',
      HttpResponse.json({ stack: 'secret' }, { status: 500 }),
    ],
    [
      'a missing response body',
      new HttpResponse(null, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ],
    [
      'a non-SSE success response',
      HttpResponse.json({ answer: 'not a stream' }),
    ],
  ])('turns %s into a safe response error', async (_, response) => {
    server.use(http.post('/api/v1/assistant/chat', () => response));

    const error = await openAssistantStream(
      { message: 'How does authentication work?', history: [] },
      csrfToken,
      new AbortController().signal,
    ).catch((caught: unknown) => caught);

    if (response.status >= 400) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect(error).toMatchObject({ title: 'Request failed' });
      expect(String(error)).not.toContain('secret');
    } else {
      expect(error).toBeInstanceOf(AssistantProtocolError);
    }
  });

  it('cancels a present response body before rejecting an invalid content type', async () => {
    const cancel = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      openAssistantStream(
        { message: 'How does authentication work?', history: [] },
        csrfToken,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(AssistantProtocolError);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
