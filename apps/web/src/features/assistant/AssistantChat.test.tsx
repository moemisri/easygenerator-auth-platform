import type { AuthSessionResponse } from '@easygenerator/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query-client';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { deferred } from '../../test/deferred';
import { server } from '../../test/server';
import { AssistantChat } from './AssistantChat';

const encoder = new TextEncoder();
const source = {
  id: 'security:sessions',
  file: 'docs/assistant-public/security.md',
  heading: 'Session security',
};
const sourceEvent = `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\n`;
const doneEvent = 'event: done\ndata: {"outcome":"answered"}\n\n';

function session(enabled = true): AuthSessionResponse {
  return {
    user: {
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
      role: 'USER',
      status: 'ACTIVE',
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    csrfToken: 'c'.repeat(32),
    features: { assistant: enabled },
  };
}

function LogoutControl() {
  const { isLoggingOut, logout, logoutError } = useAuth();
  return (
    <>
      <button
        type="button"
        disabled={isLoggingOut}
        onClick={() => void logout()}
      >
        {isLoggingOut ? 'Signing out' : 'Test logout'}
      </button>
      {logoutError && <p>{logoutError}</p>}
    </>
  );
}

function renderChat({ enabled = true, withLogout = false } = {}) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <AuthProvider restoreSession={() => Promise.resolve(session(enabled))}>
          <ProtectedRoute>
            <AssistantChat />
            {withLogout && <LogoutControl />}
          </ProtectedRoute>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function sseResponse(body: BodyInit) {
  return new HttpResponse(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function signalWiredStream(
  signal: AbortSignal,
  settle: Promise<unknown> = Promise.resolve(),
) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener(
        'abort',
        () => {
          void settle.then(() =>
            controller.error(new DOMException('Aborted', 'AbortError')),
          );
        },
        { once: true },
      );
    },
  });
}

async function ask(question: string) {
  const user = userEvent.setup();
  const textbox = await screen.findByRole('textbox', { name: 'Question' });
  await user.clear(textbox);
  await user.type(textbox, question);
  await user.click(screen.getByRole('button', { name: 'Ask assistant' }));
  return user;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AssistantChat', () => {
  it('renders sources independently, appends deltas incrementally, and announces coarse states', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    server.use(http.post('/api/v1/assistant/chat', () => sseResponse(stream)));
    renderChat();

    await ask('How are sessions protected?');
    expect(screen.getByRole('status')).toHaveTextContent('Answer in progress');

    act(() => {
      controller.enqueue(encoder.encode(sourceEvent));
    });
    expect(
      await screen.findByRole('heading', { name: 'Sources' }),
    ).toBeVisible();
    expect(screen.getByText('Session security')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Sources available');

    act(() => {
      controller.enqueue(
        encoder.encode('event: delta\ndata: {"text":"Opaque sessions"}\n\n'),
      );
    });
    expect(await screen.findByText('Opaque sessions')).toBeVisible();
    expect(screen.getByRole('status')).not.toHaveTextContent('Opaque sessions');

    act(() => {
      controller.enqueue(
        encoder.encode('event: delta\ndata: {"text":" use cookies."}\n\n'),
      );
      controller.enqueue(encoder.encode(doneEvent));
      controller.close();
    });
    expect(
      await screen.findByText('Opaque sessions use cookies.'),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Answer complete');
  });

  it('allows drafting the next question while only the send action is locked', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    server.use(
      http.post('/api/v1/assistant/chat', () =>
        sseResponse(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value;
            },
          }),
        ),
      ),
    );
    renderChat();

    const user = await ask('First question');
    const textbox = screen.getByRole('textbox', { name: 'Question' });
    expect(textbox).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Ask assistant' }),
    ).toBeDisabled();
    await user.clear(textbox);
    await user.type(textbox, 'Drafted next question');

    act(() => {
      controller.enqueue(encoder.encode(sourceEvent));
      controller.enqueue(
        encoder.encode('event: delta\ndata: {"text":"First answer"}\n\n'),
      );
      controller.enqueue(encoder.encode(doneEvent));
      controller.close();
    });

    expect(await screen.findByText('First answer')).toBeVisible();
    expect(textbox).toHaveValue('Drafted next question');
    expect(textbox).toHaveFocus();
  });

  it('keeps the transcript bounded and focuses a completed answer when the composer is idle', async () => {
    server.use(
      http.post('/api/v1/assistant/chat', () =>
        sseResponse(
          sourceEvent +
            'event: delta\ndata: {"text":"Focused answer"}\n\n' +
            doneEvent,
        ),
      ),
    );
    renderChat();

    expect(
      await screen.findByRole('region', { name: 'Conversation transcript' }),
    ).toBeVisible();
    await ask('Focus question');

    const answer = await screen.findByRole('article', {
      name: 'Assistant answer to: Focus question',
    });
    await waitFor(() => expect(answer).toHaveFocus());
  });

  it('keeps retry disabled until stop cleanup settles, then retries successfully', async () => {
    let requests = 0;
    let requestSignal: AbortSignal | undefined;
    let abortEvents = 0;
    const cleanupGate = deferred<void>();
    server.use(
      http.post('/api/v1/assistant/chat', ({ request }) => {
        requests += 1;
        if (requests > 1) {
          return sseResponse(
            sourceEvent +
              'event: delta\ndata: {"text":"Retried answer"}\n\n' +
              doneEvent,
          );
        }
        requestSignal = request.signal;
        request.signal.addEventListener('abort', () => {
          abortEvents += 1;
        });
        return sseResponse(
          signalWiredStream(request.signal, cleanupGate.promise),
        );
      }),
    );
    const view = renderChat();

    const user = await ask('How are sessions protected?');
    expect(
      await screen.findByRole('button', { name: 'Stop generating' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Ask assistant' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Ask assistant' }));
    expect(requests).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(requestSignal?.aborted).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Stopping generation');
    expect(
      screen.queryByRole('button', { name: 'Retry question' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ask assistant' }),
    ).toBeDisabled();
    expect(requests).toBe(1);

    cleanupGate.resolve();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /generation stopped/i,
    );
    await user.click(screen.getByRole('button', { name: 'Retry question' }));
    expect(await screen.findByText('Retried answer')).toBeVisible();
    expect(requests).toBe(2);
    view.unmount();
    expect(abortEvents).toBe(1);
  });

  it('aborts the active assistant request before logout begins', async () => {
    let requestSignal: AbortSignal | undefined;
    let assistantStarted = false;
    const assistantSettled = deferred<void>();
    server.use(
      http.post('/api/v1/assistant/chat', ({ request }) => {
        assistantStarted = true;
        requestSignal = request.signal;
        request.signal.addEventListener(
          'abort',
          () => assistantSettled.resolve(),
          { once: true },
        );
        return sseResponse(signalWiredStream(request.signal));
      }),
      http.post('/api/v1/auth/logout', () => {
        expect(assistantStarted).toBe(true);
        expect(requestSignal?.aborted).toBe(true);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderChat({ withLogout: true });

    const user = await ask('How are sessions protected?');
    await screen.findByRole('button', { name: 'Stop generating' });
    await user.click(screen.getByRole('button', { name: 'Test logout' }));

    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    await assistantSettled.promise;
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Question' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('locks assistant send and retry through a failed deferred logout, then recovers', async () => {
    let assistantRequests = 0;
    const logoutGate = deferred<void>();
    server.use(
      http.post('/api/v1/assistant/chat', ({ request }) => {
        assistantRequests += 1;
        if (assistantRequests === 1) {
          return sseResponse(signalWiredStream(request.signal));
        }
        return sseResponse(
          sourceEvent +
            'event: delta\ndata: {"text":"Recovered after logout failure"}\n\n' +
            doneEvent,
        );
      }),
      http.post('/api/v1/auth/logout', async () => {
        await logoutGate.promise;
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Service unavailable',
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
            requestId: 'req-logout',
          },
          { status: 503 },
        );
      }),
    );
    renderChat({ withLogout: true });

    const user = await ask('How are sessions protected?');
    await screen.findByRole('button', { name: 'Stop generating' });
    await user.click(screen.getByRole('button', { name: 'Test logout' }));

    expect(
      await screen.findByRole('button', { name: 'Signing out' }),
    ).toBeDisabled();
    const retry = await screen.findByRole('button', {
      name: 'Retry question',
    });
    expect(retry).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Ask assistant' }),
    ).toBeDisabled();
    await user.click(retry);
    expect(assistantRequests).toBe(1);

    logoutGate.resolve();
    expect(await screen.findByText(/unable to sign out/i)).toBeVisible();
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);

    expect(
      await screen.findByText('Recovered after logout failure'),
    ).toBeVisible();
    expect(assistantRequests).toBe(2);
  });

  it('aborts an active request on unmount without updating torn-down state', async () => {
    let requestSignal: AbortSignal | undefined;
    const settled = deferred<void>();
    server.use(
      http.post('/api/v1/assistant/chat', ({ request }) => {
        requestSignal = request.signal;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            request.signal.addEventListener(
              'abort',
              () => {
                controller.error(new DOMException('Aborted', 'AbortError'));
                settled.resolve();
              },
              { once: true },
            );
          },
        });
        return sseResponse(stream);
      }),
    );
    const view = renderChat();
    await ask('How are sessions protected?');
    await screen.findByRole('button', { name: 'Stop generating' });

    view.unmount();

    expect(requestSignal?.aborted).toBe(true);
    await settled.promise;
  });

  it('cancels and aborts a malformed open stream before enabling retry', async () => {
    const cleanupGate = deferred<void>();
    let streamCancelled = false;
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode('event: sources\ndata: {malformed}\n\n'),
              );
            },
            async cancel() {
              streamCancelled = true;
              await cleanupGate.promise;
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );
    });
    renderChat();
    await ask('How are sessions protected?');

    await waitFor(() => expect(streamCancelled).toBe(true));
    expect(requestSignal?.aborted).toBe(false);
    expect(
      screen.queryByRole('button', { name: 'Retry question' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ask assistant' }),
    ).toBeDisabled();

    cleanupGate.resolve();
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be completed/i,
    );
    expect(
      screen.getByRole('button', { name: 'Retry question' }),
    ).toBeVisible();
  });

  it('does not expose retry while an invalid response body is still cancelling', async () => {
    const cancellation = deferred<void>();
    let cancellationStarted = false;
    let requests = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      requests += 1;
      if (requests > 1) {
        return Promise.resolve(
          new Response(
            sourceEvent +
              'event: delta\ndata: {"text":"Retry after disposal"}\n\n' +
              doneEvent,
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            async cancel() {
              cancellationStarted = true;
              await cancellation.promise;
            },
          }),
          { headers: { 'Content-Type': 'text/event-streaming' } },
        ),
      );
    });
    renderChat();

    const user = await ask('How are sessions protected?');
    await waitFor(() => expect(cancellationStarted).toBe(true));
    expect(
      screen.queryByRole('button', { name: 'Retry question' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ask assistant' }),
    ).toBeDisabled();

    cancellation.resolve();
    const retry = await screen.findByRole('button', {
      name: 'Retry question',
    });
    await user.click(retry);

    expect(await screen.findByText('Retry after disposal')).toBeVisible();
    expect(requests).toBe(2);
  });

  it('aborts after the 30-second client deadline and offers a safe retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let requestSignal: AbortSignal | undefined;
    server.use(
      http.post('/api/v1/assistant/chat', ({ request }) => {
        requestSignal = request.signal;
        return sseResponse(signalWiredStream(request.signal));
      }),
    );
    renderChat();
    await ask('How are sessions protected?');
    await screen.findByRole('button', { name: 'Stop generating' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(requestSignal?.aborted).toBe(true);
    expect(await screen.findByText(/took too long/i)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Retry question' }),
    ).toBeVisible();
  });

  it('clears the exact client deadline after a clean terminal response', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    server.use(
      http.post('/api/v1/assistant/chat', () =>
        sseResponse(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value;
            },
          }),
        ),
      ),
    );
    renderChat();

    await ask('How are sessions protected?');
    const deadlineIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, delay]) => delay === 30_000,
    );
    expect(deadlineIndex).toBeGreaterThanOrEqual(0);
    const deadline = setTimeoutSpy.mock.results[deadlineIndex]
      ?.value as unknown;
    clearTimeoutSpy.mockClear();

    act(() => {
      controller.enqueue(encoder.encode(sourceEvent));
      controller.enqueue(
        encoder.encode('event: delta\ndata: {"text":"Completed answer"}\n\n'),
      );
      controller.enqueue(encoder.encode(doneEvent));
      controller.close();
    });
    await waitFor(() => {
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(deadline);
    });

    expect(await screen.findByText('Completed answer')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Answer complete'),
    );
  });

  it('sends only the six most recent completed messages as history', async () => {
    const requests: unknown[] = [];
    let turn = 0;
    server.use(
      http.post('/api/v1/assistant/chat', async ({ request }) => {
        requests.push(await request.json());
        turn += 1;
        return sseResponse(
          sourceEvent +
            `event: delta\ndata: ${JSON.stringify({ text: `Answer ${turn}` })}\n\n` +
            doneEvent,
        );
      }),
    );
    renderChat();

    for (let question = 1; question <= 5; question += 1) {
      await ask(`Question ${question}`);
      await screen.findByText(`Answer ${question}`);
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Answer complete'),
      );
    }

    expect(requests[3]).toEqual({
      message: 'Question 4',
      history: [
        { role: 'user', content: 'Question 1' },
        { role: 'assistant', content: 'Answer 1' },
        { role: 'user', content: 'Question 2' },
        { role: 'assistant', content: 'Answer 2' },
        { role: 'user', content: 'Question 3' },
        { role: 'assistant', content: 'Answer 3' },
      ],
    });
    expect(requests[4]).toEqual({
      message: 'Question 5',
      history: [
        { role: 'user', content: 'Question 2' },
        { role: 'assistant', content: 'Answer 2' },
        { role: 'user', content: 'Question 3' },
        { role: 'assistant', content: 'Answer 3' },
        { role: 'user', content: 'Question 4' },
        { role: 'assistant', content: 'Answer 4' },
      ],
    });
  });

  it('displays a long answer fully and bounds future history without splitting a surrogate pair', async () => {
    const longAnswer = `${'a'.repeat(999)}😀tail`;
    const requests: Array<{
      message: string;
      history: Array<{ role: string; content: string }>;
    }> = [];
    server.use(
      http.post('/api/v1/assistant/chat', async ({ request }) => {
        requests.push((await request.json()) as (typeof requests)[number]);
        if (requests.length === 1) {
          return sseResponse(
            sourceEvent +
              `event: delta\ndata: ${JSON.stringify({ text: longAnswer })}\n\n` +
              doneEvent,
          );
        }
        return sseResponse(
          sourceEvent +
            'event: delta\ndata: {"text":"Follow-up answer"}\n\n' +
            doneEvent,
        );
      }),
    );
    renderChat();

    await ask('First question');
    expect(await screen.findByText(longAnswer)).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Answer complete'),
    );

    await ask('Follow-up question');
    expect(await screen.findByText('Follow-up answer')).toBeVisible();
    expect(requests[1]).toEqual({
      message: 'Follow-up question',
      history: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'a'.repeat(999) },
      ],
    });
    expect(requests[1]?.history[1]?.content.length).toBeLessThanOrEqual(1_000);
  });

  it('fails safely instead of completing an excessively large aggregate answer', async () => {
    const oversizedAnswer = Array.from(
      { length: 9 },
      () =>
        `event: delta\ndata: ${JSON.stringify({ text: 'x'.repeat(8_192) })}\n\n`,
    ).join('');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(sourceEvent + oversizedAnswer + doneEvent, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    renderChat();

    await ask('How are sessions protected?');

    expect(
      await screen.findByText(/request could not be completed/i),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Assistant request failed',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('Answer complete');
  });

  it('keeps a source-only completed turn visible without sending fabricated history', async () => {
    const requests: Array<{ message: string; history: unknown[] }> = [];
    server.use(
      http.post('/api/v1/assistant/chat', async ({ request }) => {
        requests.push((await request.json()) as (typeof requests)[number]);
        if (requests.length === 1) {
          return sseResponse(sourceEvent + doneEvent);
        }
        return sseResponse(
          sourceEvent +
            'event: delta\ndata: {"text":"Second answer"}\n\n' +
            doneEvent,
        );
      }),
    );
    renderChat();

    await ask('First source-only question');
    expect(
      await screen.findByText(/no answer text was returned/i),
    ).toBeVisible();
    expect(screen.getByText('Session security')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Answer complete'),
    );

    await ask('Second question');
    expect(await screen.findByText('Second answer')).toBeVisible();
    expect(screen.getAllByText('Session security')).toHaveLength(2);
    expect(requests[1]).toEqual({ message: 'Second question', history: [] });
  });

  it('retries from committed history without committing a failed partial answer', async () => {
    const requests: Array<{ message: string; history: unknown[] }> = [];
    let requestNumber = 0;
    server.use(
      http.post('/api/v1/assistant/chat', async ({ request }) => {
        requests.push((await request.json()) as (typeof requests)[number]);
        requestNumber += 1;
        if (requestNumber === 1) {
          return sseResponse(
            sourceEvent +
              'event: delta\ndata: {"text":"First answer"}\n\n' +
              doneEvent,
          );
        }
        if (requestNumber === 2) {
          return sseResponse(
            sourceEvent +
              'event: delta\ndata: {"text":"Uncommitted fragment"}\n\n' +
              'event: error\ndata: {"code":"ASSISTANT_PROVIDER_UNAVAILABLE","message":"The assistant is temporarily unavailable."}\n\n',
          );
        }
        return sseResponse(
          sourceEvent +
            'event: delta\ndata: {"text":"Recovered answer"}\n\n' +
            doneEvent,
        );
      }),
    );
    renderChat();

    await ask('First question');
    await screen.findByText('First answer');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Answer complete'),
    );
    const user = await ask('Second question');
    expect(await screen.findByText('Uncommitted fragment')).toBeVisible();
    expect(
      await screen.findByText('The assistant is temporarily unavailable.'),
    ).toBeVisible();
    expect(screen.getAllByText('Session security')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Retry question' }));
    expect(await screen.findByText('Recovered answer')).toBeVisible();
    expect(requests[2]).toEqual({
      message: 'Second question',
      history: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
      ],
    });
  });

  it('shows the grounded refusal without fabricating prose or sources', async () => {
    server.use(
      http.post('/api/v1/assistant/chat', () =>
        sseResponse(
          'event: sources\ndata: {"sources":[]}\n\n' +
            'event: done\ndata: {"outcome":"refused"}\n\n',
        ),
      ),
    );
    renderChat();

    await ask('Tell me Ada’s private details');

    expect(
      await screen.findByText(
        /public documentation does not support an answer/i,
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Sources' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Question refused');
  });

  it('does not POST and renders a direct-navigation state when the feature is disabled', async () => {
    let requests = 0;
    server.use(
      http.post('/api/v1/assistant/chat', () => {
        requests += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    renderChat({ enabled: false });

    expect(
      await screen.findByText(/assistant is not enabled for this environment/i),
    ).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: 'Question' }),
    ).not.toBeInTheDocument();
    expect(requests).toBe(0);
  });

  it.each([
    [
      'ASSISTANT_DISABLED',
      404,
      'The assistant is not enabled for this environment.',
      0,
    ],
    ['ASSISTANT_RATE_LIMITED', 429, 'The assistant is busy right now.', 1],
    [
      'SERVICE_UNAVAILABLE',
      503,
      'The assistant request could not be completed.',
      0,
    ],
  ])(
    'maps %s pre-stream failures to a safe UI state',
    async (code, status, copy, retryNotices) => {
      server.use(
        http.post('/api/v1/assistant/chat', () =>
          HttpResponse.json(
            {
              type: 'https://example.com/problems/assistant',
              title: 'Do not display this title',
              status,
              code,
              requestId: 'req-assistant',
            },
            status === 429
              ? { status, headers: { 'Retry-After': '2' } }
              : { status },
          ),
        ),
      );
      renderChat();

      await ask('How are sessions protected?');

      expect(await screen.findByText(new RegExp(copy, 'i'))).toBeVisible();
      expect(
        screen.queryByText('Do not display this title'),
      ).not.toBeInTheDocument();
      expect(screen.queryAllByText(/try again in 2s/i)).toHaveLength(
        retryNotices,
      );
    },
  );

  it('turns a network failure into a safe retryable state', async () => {
    server.use(http.post('/api/v1/assistant/chat', () => HttpResponse.error()));
    renderChat();

    await ask('How are sessions protected?');

    expect(
      await screen.findByText(/request could not be completed/i),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Retry question' }),
    ).toBeVisible();
  });

  it('shows the privacy boundary and preserves keyboard-accessible multiline input', async () => {
    renderChat();

    expect(
      await screen.findByText(/selected public excerpts are sent to Gemini/i),
    ).toBeVisible();
    expect(
      screen.getByText(/must not submit personal, secret, or sensitive/i),
    ).toBeVisible();
    const textbox = screen.getByRole('textbox', { name: 'Question' });
    expect(textbox).toHaveAttribute('maxLength', '1000');
    expect(
      screen.getByRole('button', { name: 'Ask assistant' }),
    ).toHaveAttribute('type', 'submit');
  });
});
