import { EventEmitter } from 'node:events';

import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../audit/audit.service';
import { AppError } from '../../platform/errors/app-error';
import type { AssistantCacheService } from './assistant-cache.service';
import type {
  AssistantConcurrencyService,
  AssistantLease,
} from './assistant-concurrency.service';
import type { DocumentLoaderService } from './document-loader.service';
import type { AssistantRateLimiterService } from './assistant-rate-limiter.service';
import { AssistantRateLimitError } from './assistant.errors';
import { AssistantService } from './assistant.service';
import type {
  AssistantCorpus,
  AssistantProvider,
  AssistantRequestEvents,
  AssistantStreamResponse,
} from './assistant.types';
import type { RetrieverService } from './retriever.service';

const corpus: AssistantCorpus = {
  digest: 'digest',
  chunks: [
    {
      id: 'session-chunk',
      file: 'authentication.md',
      heading: 'Sessions',
      content: '# Sessions\nSessions are server-side.',
    },
  ],
};
const lease: AssistantLease = {
  key: 'easygenerator:test:assistant:active:user-1',
  token: 'opaque-token',
};

class RequestEvents extends EventEmitter implements AssistantRequestEvents {
  override on(event: 'close', listener: () => void): this {
    return super.on(event, listener);
  }

  override off(event: 'close', listener: () => void): this {
    return super.off(event, listener);
  }
}

class StreamResponse extends EventEmitter implements AssistantStreamResponse {
  destroyed = false;
  headersSent = false;
  readonly headers = new Map<string, string>();
  readonly chunks: string[] = [];
  endCalls = 0;

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  flushHeaders(): void {
    this.headersSent = true;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): void {
    this.endCalls += 1;
  }

  disconnect(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

function events(response: StreamResponse): unknown[] {
  return response.chunks.map((frame) => {
    const match = /^event: ([^\n]+)\ndata: ([^\n]+)\n\n$/.exec(frame);
    if (match === null) throw new Error(`Invalid frame: ${frame}`);
    return { type: match[1], data: JSON.parse(match[2]!) };
  });
}

interface Overrides {
  assistantEnabled?: boolean;
  loadCorpus?: AssistantCorpus;
  provider?: AssistantProvider;
  cacheGet?: ReturnType<typeof vi.fn>;
  cacheSet?: ReturnType<typeof vi.fn>;
  retrieve?: ReturnType<typeof vi.fn>;
  enforce?: ReturnType<typeof vi.fn>;
  acquire?: ReturnType<typeof vi.fn>;
  release?: ReturnType<typeof vi.fn>;
  audit?: ReturnType<typeof vi.fn>;
  logError?: ReturnType<typeof vi.fn>;
  deadlineMilliseconds?: number;
}

function createService(overrides: Overrides = {}) {
  const load = vi.fn(async () => overrides.loadCorpus ?? corpus);
  const retrieve =
    overrides.retrieve ??
    vi.fn(() => ({
      kind: 'answer' as const,
      normalizedQuery: 'explain sessions',
      chunks: [{ ...corpus.chunks[0]!, coverage: 1 }],
    }));
  const cacheGet = overrides.cacheGet ?? vi.fn(async () => null);
  const cacheSet = overrides.cacheSet ?? vi.fn(async () => undefined);
  const enforce = overrides.enforce ?? vi.fn(async () => undefined);
  const acquire = overrides.acquire ?? vi.fn(async () => lease);
  const release = overrides.release ?? vi.fn(async () => undefined);
  const audit = overrides.audit ?? vi.fn(async () => undefined);
  const logError = overrides.logError ?? vi.fn();
  const provider: AssistantProvider = overrides.provider ?? {
    stream: vi.fn(() =>
      (async function* () {
        yield 'Sessions are ';
        yield 'server-side.';
      })(),
    ),
  };
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'ASSISTANT_ENABLED') {
        return overrides.assistantEnabled ?? true;
      }
      throw new Error(`Unexpected config ${key}`);
    },
  } as ConfigService;
  const service = new AssistantService(
    config,
    { load } as unknown as DocumentLoaderService,
    { search: retrieve } as unknown as RetrieverService,
    { get: cacheGet, set: cacheSet } as unknown as AssistantCacheService,
    { enforce } as unknown as AssistantRateLimiterService,
    { acquire, release } as unknown as AssistantConcurrencyService,
    provider,
    { record: audit } as unknown as AuditService,
    { error: logError } as unknown as PinoLogger,
    overrides.deadlineMilliseconds ?? 30_000,
  );
  return {
    service,
    load,
    retrieve,
    cacheGet,
    cacheSet,
    enforce,
    acquire,
    release,
    audit,
    logError,
    provider,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function iterableFrom(iterator: AsyncIterator<string>): AsyncIterable<string> {
  return { [Symbol.asyncIterator]: () => iterator };
}

const input = {
  message: 'Explain sessions',
  history: [
    { role: 'user' as const, content: 'What stores authentication state?' },
    {
      role: 'assistant' as const,
      content: 'The public docs discuss sessions.',
    },
  ],
};
const context = { requestId: 'request-1', userId: 'user-1' };

describe('AssistantService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns disabled before retrieval, Redis, or provider stream access', async () => {
    const dependencies = createService({ assistantEnabled: false });
    const request = new RequestEvents();
    const response = new StreamResponse();

    await expect(
      dependencies.service.chat(input, context, request, response),
    ).rejects.toMatchObject({ code: 'ASSISTANT_DISABLED', status: 404 });
    expect(dependencies.load).not.toHaveBeenCalled();
    expect(dependencies.cacheGet).not.toHaveBeenCalled();
    expect(dependencies.enforce).not.toHaveBeenCalled();
    expect(dependencies.acquire).not.toHaveBeenCalled();
    expect(dependencies.provider.stream).not.toHaveBeenCalled();
    expect(response.headersSent).toBe(false);
  });

  it('emits sources first, provider deltas, and one answered terminal event', async () => {
    const dependencies = createService();
    const request = new RequestEvents();
    const response = new StreamResponse();

    await dependencies.service.chat(input, context, request, response);

    expect(response.headers).toEqual(
      new Map([
        ['content-type', 'text/event-stream; charset=utf-8'],
        ['cache-control', 'no-store, no-transform'],
        ['connection', 'keep-alive'],
        ['x-accel-buffering', 'no'],
      ]),
    );
    expect(events(response)).toEqual([
      {
        type: 'sources',
        data: {
          sources: [
            {
              id: 'session-chunk',
              file: 'authentication.md',
              heading: 'Sessions',
            },
          ],
        },
      },
      { type: 'delta', data: { text: 'Sessions are ' } },
      { type: 'delta', data: { text: 'server-side.' } },
      { type: 'done', data: { outcome: 'answered' } },
    ]);
    expect(response.endCalls).toBe(1);
    expect(dependencies.release).toHaveBeenCalledOnce();
    expect(dependencies.provider.stream).toHaveBeenCalledWith(
      {
        system: expect.stringContaining('only the numbered public excerpts'),
        contents: expect.stringMatching(
          /Prior conversation:[\s\S]*What stores authentication state\?[\s\S]*Current user message:\nExplain sessions[\s\S]*\[Source 1\] authentication\.md — Sessions[\s\S]*Sessions are server-side\./,
        ),
        maxOutputTokens: 800,
      },
      expect.any(AbortSignal),
    );
  });

  it('locally refuses with empty sources and no provider call', async () => {
    const dependencies = createService({
      retrieve: vi.fn(() => ({
        kind: 'refusal',
        normalizedQuery: 'weather cairo',
        reason: 'INSUFFICIENT_DOCUMENTATION',
      })),
    });
    const request = new RequestEvents();
    const response = new StreamResponse();

    await dependencies.service.chat(
      { message: 'Weather in Cairo?', history: [] },
      context,
      request,
      response,
    );

    expect(events(response)).toEqual([
      { type: 'sources', data: { sources: [] } },
      { type: 'done', data: { outcome: 'refused' } },
    ]);
    expect(dependencies.provider.stream).not.toHaveBeenCalled();
    expect(dependencies.cacheSet).toHaveBeenCalledWith(
      corpus,
      'weather cairo',
      [],
    );
    expect(dependencies.audit).toHaveBeenCalledWith({
      action: 'ASSISTANT_REFUSED',
      actorId: 'user-1',
      reason: 'INSUFFICIENT_DOCUMENTATION',
      requestId: 'request-1',
    });
  });

  it('records only safe rate-limit audit metadata and does not acquire a lease', async () => {
    const dependencies = createService({
      enforce: vi.fn(async () => {
        throw new AssistantRateLimitError(42);
      }),
    });

    await expect(
      dependencies.service.chat(
        input,
        context,
        new RequestEvents(),
        new StreamResponse(),
      ),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 42,
    });
    expect(dependencies.audit).toHaveBeenCalledWith({
      action: 'ASSISTANT_REFUSED',
      actorId: 'user-1',
      reason: 'RATE_LIMITED',
      requestId: 'request-1',
    });
    expect(JSON.stringify(dependencies.audit.mock.calls)).not.toContain(
      input.message,
    );
    expect(dependencies.acquire).not.toHaveBeenCalled();
  });

  it('keeps a cache protection failure as a pre-stream problem and never calls the provider', async () => {
    const dependencies = createService({
      cacheGet: vi.fn(async () => {
        throw new AppError('ASSISTANT_PROTECTION_UNAVAILABLE', 503);
      }),
    });
    const response = new StreamResponse();

    await expect(
      dependencies.service.chat(input, context, new RequestEvents(), response),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    expect(response.headersSent).toBe(false);
    expect(dependencies.provider.stream).not.toHaveBeenCalled();
    expect(dependencies.release).toHaveBeenCalledOnce();
  });

  it('rejects oversized fresh retrieval excerpts at orchestration before cache or provider access', async () => {
    const oversized = {
      ...corpus.chunks[0]!,
      content: 'x'.repeat(12_001),
      coverage: 1,
    };
    const dependencies = createService({
      retrieve: vi.fn(() => ({
        kind: 'answer' as const,
        normalizedQuery: 'explain sessions',
        chunks: [oversized],
      })),
    });
    const response = new StreamResponse();

    await expect(
      dependencies.service.chat(input, context, new RequestEvents(), response),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
    expect(dependencies.cacheSet).not.toHaveBeenCalled();
    expect(dependencies.provider.stream).not.toHaveBeenCalled();
    expect(response.headersSent).toBe(false);
    expect(dependencies.release).toHaveBeenCalledOnce();
  });

  it('rejects oversized rehydrated cache excerpts before provider access', async () => {
    const oversizedCorpus: AssistantCorpus = {
      digest: 'oversized-digest',
      chunks: [
        {
          ...corpus.chunks[0]!,
          content: 'x'.repeat(12_001),
        },
      ],
    };
    const dependencies = createService({
      loadCorpus: oversizedCorpus,
      cacheGet: vi.fn(async () => oversizedCorpus.chunks),
    });
    const response = new StreamResponse();

    await expect(
      dependencies.service.chat(input, context, new RequestEvents(), response),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
    expect(dependencies.retrieve).not.toHaveBeenCalled();
    expect(dependencies.provider.stream).not.toHaveBeenCalled();
    expect(response.headersSent).toBe(false);
    expect(dependencies.release).toHaveBeenCalledOnce();
  });

  it('emits one safe provider error and never emits done after it', async () => {
    const iterator = {
      next: vi.fn(async () => {
        throw new Error('private provider response');
      }),
      return: vi.fn(async () => ({ done: true as const, value: undefined })),
    };
    const dependencies = createService({
      provider: {
        stream: () => iterableFrom(iterator),
      },
    });
    const response = new StreamResponse();

    await dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      response,
    );

    expect(events(response)).toEqual([
      {
        type: 'sources',
        data: {
          sources: [
            {
              id: 'session-chunk',
              file: 'authentication.md',
              heading: 'Sessions',
            },
          ],
        },
      },
      {
        type: 'error',
        data: {
          code: 'ASSISTANT_PROVIDER_UNAVAILABLE',
          message:
            'The assistant is temporarily unavailable. Please try again.',
        },
      },
    ]);
    expect(response.chunks.join('')).not.toContain('private provider response');
    expect(iterator.return).toHaveBeenCalledOnce();
    expect(iterator.return.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.release.mock.invocationCallOrder[0]!,
    );
  });

  it('enforces the deadline even when the provider ignores abort', async () => {
    const iterator = {
      next: vi.fn(() => new Promise<IteratorResult<string>>(() => undefined)),
      return: vi.fn(async () => ({ done: true as const, value: undefined })),
    };
    let providerSignal: AbortSignal | undefined;
    const dependencies = createService({
      deadlineMilliseconds: 20,
      provider: {
        stream: (_input, signal) => {
          providerSignal = signal;
          return iterableFrom(iterator);
        },
      },
    });
    const response = new StreamResponse();

    await dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      response,
    );

    expect(events(response).at(-1)).toEqual({
      type: 'error',
      data: {
        code: 'ASSISTANT_TIMEOUT',
        message: 'The assistant timed out. Please try again.',
      },
    });
    expect(
      events(response).some(
        (event) => (event as { type: string }).type === 'done',
      ),
    ).toBe(false);
    expect(providerSignal?.aborted).toBe(true);
    expect(iterator.return).toHaveBeenCalledOnce();
    expect(iterator.return.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.release.mock.invocationCallOrder[0]!,
    );
    expect(dependencies.release).toHaveBeenCalledOnce();
  });

  it('awaits disconnect iterator finalization before releasing its lease', async () => {
    const nextStarted = deferred<void>();
    const allowReturn = deferred<void>();
    const iterator = {
      next: vi.fn(() => {
        nextStarted.resolve();
        return new Promise<IteratorResult<string>>(() => undefined);
      }),
      return: vi.fn(async () => {
        await allowReturn.promise;
        return { done: true as const, value: undefined };
      }),
    };
    const dependencies = createService({
      provider: { stream: () => iterableFrom(iterator) },
    });
    const response = new StreamResponse();
    const pending = dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      response,
    );
    await nextStarted.promise;

    response.disconnect();
    await vi.waitFor(() => expect(iterator.return).toHaveBeenCalledOnce());
    expect(dependencies.release).not.toHaveBeenCalled();

    allowReturn.resolve();
    await pending;

    expect(iterator.return).toHaveBeenCalledOnce();
    expect(dependencies.release).toHaveBeenCalledOnce();
    expect(iterator.return.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.release.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the lease for TTL cleanup when iterator finalization cannot be confirmed', async () => {
    const nextStarted = deferred<void>();
    const iterator = {
      next: vi.fn(() => {
        nextStarted.resolve();
        return new Promise<IteratorResult<string>>(() => undefined);
      }),
      return: vi.fn(async () => {
        throw new Error('private iterator cleanup failure');
      }),
    };
    const dependencies = createService({
      provider: { stream: () => iterableFrom(iterator) },
    });
    const response = new StreamResponse();
    const pending = dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      response,
    );
    await nextStarted.promise;

    response.disconnect();
    await pending;

    expect(iterator.return).toHaveBeenCalledOnce();
    expect(dependencies.release).not.toHaveBeenCalled();
  });

  it('finalizes the iterator before lease release when a delta cannot be written', async () => {
    const response = new StreamResponse();
    const iterator = {
      next: vi.fn(async () => {
        response.destroyed = true;
        return { done: false as const, value: 'must not be written' };
      }),
      return: vi.fn(async () => ({ done: true as const, value: undefined })),
    };
    const dependencies = createService({
      provider: { stream: () => iterableFrom(iterator) },
    });

    await dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      response,
    );

    expect(
      events(response).map((event) => (event as { type: string }).type),
    ).toEqual(['sources']);
    expect(iterator.return).toHaveBeenCalledOnce();
    expect(iterator.return.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.release.mock.invocationCallOrder[0]!,
    );
  });

  it('registers disconnect handling before delayed acquire and releases a late lease exactly once', async () => {
    const acquired = deferred<AssistantLease>();
    const acquire = vi.fn(() => acquired.promise);
    const dependencies = createService({ acquire });
    const request = new RequestEvents();
    const response = new StreamResponse();
    const pending = dependencies.service.chat(
      input,
      context,
      request,
      response,
    );
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());

    request.emit('close');
    acquired.resolve(lease);
    await pending;

    expect(dependencies.load).not.toHaveBeenCalled();
    expect(dependencies.retrieve).not.toHaveBeenCalled();
    expect(dependencies.provider.stream).not.toHaveBeenCalled();
    expect(dependencies.release).toHaveBeenCalledExactlyOnceWith(lease);
  });

  it('registers disconnect handling before delayed rate limiting and never acquires afterward', async () => {
    const enforced = deferred<void>();
    const enforce = vi.fn(() => enforced.promise);
    const dependencies = createService({ enforce });
    const request = new RequestEvents();
    const pending = dependencies.service.chat(
      input,
      context,
      request,
      new StreamResponse(),
    );
    await vi.waitFor(() => expect(enforce).toHaveBeenCalledOnce());

    request.emit('close');
    enforced.resolve();
    await pending;

    expect(dependencies.acquire).not.toHaveBeenCalled();
    expect(dependencies.load).not.toHaveBeenCalled();
    expect(dependencies.provider.stream).not.toHaveBeenCalled();
    expect(dependencies.release).not.toHaveBeenCalled();
  });

  it('aborts on response close, stops writing, and releases exactly once', async () => {
    let started!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let abortObserved = false;
    const dependencies = createService({
      deadlineMilliseconds: 50,
      provider: {
        stream: (_input, signal) =>
          (async function* () {
            started();
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                'abort',
                () => {
                  abortObserved = true;
                  resolve();
                },
                { once: true },
              );
            });
            yield 'must not be written';
          })(),
      },
    });
    const response = new StreamResponse();
    const pending = dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      response,
    );
    await providerStarted;

    response.disconnect();
    const completedPromptly = await Promise.race([
      pending.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    await pending;

    expect(completedPromptly).toBe(true);
    expect(abortObserved).toBe(true);
    expect(
      events(response).map((event) => (event as { type: string }).type),
    ).toEqual(['sources']);
    expect(response.endCalls).toBe(0);
    expect(dependencies.release).toHaveBeenCalledOnce();
  });

  it('logs only request ID and a stable code when lease cleanup fails', async () => {
    const dependencies = createService({
      release: vi.fn(async () => {
        throw new Error('safe-key opaque-token redis://private-host');
      }),
    });
    const response = new StreamResponse();

    await dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      response,
    );

    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_LEASE_RELEASE_FAILED',
        requestId: 'request-1',
      },
      'Assistant lease release failed',
    );
    expect(JSON.stringify(dependencies.logError.mock.calls)).not.toContain(
      'opaque-token',
    );
    expect(response.endCalls).toBe(1);
  });
});
