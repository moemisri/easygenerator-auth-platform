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
  AssistantProviderInput,
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
  key: 'easygenerator:test:assistant:active:M6To1MuG1VkKSKaOKnbusSS5COHv2SUumJWam58z708',
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

interface StreamEvent {
  type: string;
  data: unknown;
}

function events(response: StreamResponse): StreamEvent[] {
  return response.chunks.map((frame) => {
    const match = /^event: ([^\n]+)\ndata: ([^\n]+)\n\n$/.exec(frame);
    if (match === null) throw new Error(`Invalid frame: ${frame}`);
    const data: unknown = JSON.parse(match[2]!);
    return { type: match[1]!, data };
  });
}

function iterableOf(...values: string[]): AsyncIterable<string> {
  let index = 0;
  return iterableFrom({
    next: () => {
      const value = values[index];
      index += 1;
      return Promise.resolve(
        value === undefined
          ? { done: true as const, value: undefined }
          : { done: false as const, value },
      );
    },
  });
}

interface Overrides {
  assistantEnabled?: boolean;
  load?: ReturnType<typeof vi.fn>;
  loadCorpus?: AssistantCorpus;
  provider?: AssistantProvider;
  cacheGet?: ReturnType<typeof vi.fn>;
  cacheSet?: ReturnType<typeof vi.fn>;
  retrieve?: ReturnType<typeof vi.fn>;
  enforce?: ReturnType<typeof vi.fn>;
  acquire?: ReturnType<typeof vi.fn>;
  renew?: ReturnType<typeof vi.fn>;
  release?: ReturnType<typeof vi.fn>;
  audit?: ReturnType<typeof vi.fn>;
  logError?: ReturnType<typeof vi.fn>;
  deadlineMilliseconds?: number;
  leaseRenewalMilliseconds?: number;
}

function createService(overrides: Overrides = {}) {
  const load =
    overrides.load ??
    vi.fn(() => Promise.resolve(overrides.loadCorpus ?? corpus));
  const retrieve =
    overrides.retrieve ??
    vi.fn(() => ({
      kind: 'answer' as const,
      normalizedQuery: 'explain sessions',
      chunks: [{ ...corpus.chunks[0]!, coverage: 1 }],
    }));
  const cacheGet = overrides.cacheGet ?? vi.fn(() => Promise.resolve(null));
  const cacheSet =
    overrides.cacheSet ?? vi.fn(() => Promise.resolve(undefined));
  const enforce = overrides.enforce ?? vi.fn(() => Promise.resolve(undefined));
  const acquire = overrides.acquire ?? vi.fn(() => Promise.resolve(lease));
  const renew = overrides.renew ?? vi.fn(() => Promise.resolve(undefined));
  const release = overrides.release ?? vi.fn(() => Promise.resolve(undefined));
  const audit = overrides.audit ?? vi.fn(() => Promise.resolve(undefined));
  const logError = overrides.logError ?? vi.fn();
  const overriddenProvider = overrides.provider;
  const providerInvoked = vi.fn();
  const providerCalls: Array<[AssistantProviderInput, AbortSignal]> = [];
  const provider: AssistantProvider = {
    stream(providerInput, signal) {
      providerInvoked();
      providerCalls.push([providerInput, signal]);
      if (overriddenProvider !== undefined) {
        return overriddenProvider.stream(providerInput, signal);
      }
      return iterableOf('Sessions are ', 'server-side.');
    },
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
    { acquire, renew, release } as unknown as AssistantConcurrencyService,
    provider,
    { record: audit } as unknown as AuditService,
    { error: logError } as unknown as PinoLogger,
    overrides.deadlineMilliseconds ?? 30_000,
    overrides.leaseRenewalMilliseconds ?? 10_000,
  );
  return {
    service,
    load,
    retrieve,
    cacheGet,
    cacheSet,
    enforce,
    acquire,
    renew,
    release,
    audit,
    logError,
    providerInvoked,
    providerCalls,
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
const context = {
  requestId: 'request-1',
  requestIp: '192.0.2.10',
  userId: 'user-1',
};

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
    expect(dependencies.providerInvoked).not.toHaveBeenCalled();
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
    expect(dependencies.enforce).toHaveBeenCalledWith('user-1', '192.0.2.10');
    expect(dependencies.release).toHaveBeenCalledOnce();
    expect(dependencies.providerInvoked).toHaveBeenCalledOnce();
    const providerCall = dependencies.providerCalls[0];
    if (providerCall === undefined) throw new Error('Provider was not called');
    const [providerInput, providerSignal] = providerCall;
    expect(providerInput.system).toContain('only the numbered public excerpts');
    expect(providerInput.contents).toMatch(
      /Prior conversation:[\s\S]*What stores authentication state\?[\s\S]*Current user message:\nExplain sessions[\s\S]*\[Source 1\] authentication\.md — Sessions[\s\S]*Sessions are server-side\./,
    );
    expect(providerInput.maxOutputTokens).toBe(800);
    expect(providerSignal).toBeInstanceOf(AbortSignal);
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
    expect(dependencies.providerInvoked).not.toHaveBeenCalled();
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
      enforce: vi.fn(() => Promise.reject(new AssistantRateLimitError(42))),
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

  it('preserves a rate-limit response when refusal auditing fails', async () => {
    const dependencies = createService({
      enforce: vi.fn(() => Promise.reject(new AssistantRateLimitError(42))),
      audit: vi.fn(() =>
        Promise.reject(new Error('mongodb://private-host audit failure')),
      ),
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
    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_REFUSAL_AUDIT_FAILED',
        requestId: 'request-1',
      },
      'Assistant refusal audit failed',
    );
    expect(JSON.stringify(dependencies.logError.mock.calls)).not.toContain(
      'private-host',
    );
    expect(dependencies.acquire).not.toHaveBeenCalled();
  });

  it('preserves a local refusal when refusal auditing fails', async () => {
    const dependencies = createService({
      retrieve: vi.fn(() => ({
        kind: 'refusal',
        normalizedQuery: 'weather cairo',
        reason: 'INSUFFICIENT_DOCUMENTATION',
      })),
      audit: vi.fn(() =>
        Promise.reject(new Error('mongodb://private-host audit failure')),
      ),
    });
    const response = new StreamResponse();

    await dependencies.service.chat(
      { message: 'Weather in Cairo?', history: [] },
      context,
      new RequestEvents(),
      response,
    );

    expect(events(response)).toEqual([
      { type: 'sources', data: { sources: [] } },
      { type: 'done', data: { outcome: 'refused' } },
    ]);
    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_REFUSAL_AUDIT_FAILED',
        requestId: 'request-1',
      },
      'Assistant refusal audit failed',
    );
    expect(dependencies.providerInvoked).not.toHaveBeenCalled();
  });

  it('acquires the provider lease only after a slow retrieval preamble finishes', async () => {
    const loadStarted = deferred<void>();
    const allowLoad = deferred<AssistantCorpus>();
    const load = vi.fn(() => {
      loadStarted.resolve();
      return allowLoad.promise;
    });
    const dependencies = createService({ load });
    const pending = dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      new StreamResponse(),
    );

    await loadStarted.promise;
    expect(dependencies.acquire).not.toHaveBeenCalled();

    allowLoad.resolve(corpus);
    await pending;

    expect(dependencies.acquire).toHaveBeenCalledOnce();
    expect(dependencies.cacheSet.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.acquire.mock.invocationCallOrder[0]!,
    );
    expect(dependencies.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.providerInvoked.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps a cache protection failure as a pre-stream problem and never calls the provider', async () => {
    const dependencies = createService({
      cacheGet: vi.fn(() =>
        Promise.reject(new AppError('ASSISTANT_PROTECTION_UNAVAILABLE', 503)),
      ),
    });
    const response = new StreamResponse();

    await expect(
      dependencies.service.chat(input, context, new RequestEvents(), response),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    expect(response.headersSent).toBe(false);
    expect(dependencies.providerInvoked).not.toHaveBeenCalled();
    expect(dependencies.release).not.toHaveBeenCalled();
    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_CACHE_GET_FAILED',
        requestId: 'request-1',
      },
      'Assistant cache read failed',
    );
  });

  it('safely identifies a normalized rate-limit protection failure', async () => {
    const dependencies = createService({
      enforce: vi.fn(() =>
        Promise.reject(new AppError('ASSISTANT_PROTECTION_UNAVAILABLE', 503)),
      ),
    });

    await expect(
      dependencies.service.chat(
        input,
        context,
        new RequestEvents(),
        new StreamResponse(),
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_RATE_LIMIT_CHECK_FAILED',
        requestId: 'request-1',
      },
      'Assistant rate-limit check failed',
    );
  });

  it('safely identifies a normalized corpus load failure', async () => {
    const dependencies = createService({
      load: vi.fn(() =>
        Promise.reject(new AppError('ASSISTANT_CORPUS_UNAVAILABLE', 503)),
      ),
    });

    await expect(
      dependencies.service.chat(
        input,
        context,
        new RequestEvents(),
        new StreamResponse(),
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_CORPUS_LOAD_FAILED',
        requestId: 'request-1',
      },
      'Assistant corpus load failed',
    );
  });

  it('safely identifies a normalized cache-write protection failure', async () => {
    const dependencies = createService({
      cacheSet: vi.fn(() =>
        Promise.reject(new AppError('ASSISTANT_PROTECTION_UNAVAILABLE', 503)),
      ),
    });

    await expect(
      dependencies.service.chat(
        input,
        context,
        new RequestEvents(),
        new StreamResponse(),
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_CACHE_SET_FAILED',
        requestId: 'request-1',
      },
      'Assistant cache write failed',
    );
    expect(dependencies.acquire).not.toHaveBeenCalled();
  });

  it('emits one safe provider error and never emits done after it', async () => {
    const iterator = {
      next: vi.fn(() => Promise.reject(new Error('private provider response'))),
      return: vi.fn(() =>
        Promise.resolve({ done: true as const, value: undefined }),
      ),
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
    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_PROVIDER_STREAM_FAILED',
        requestId: 'request-1',
      },
      'Assistant provider stream failed',
    );
    expect(JSON.stringify(dependencies.logError.mock.calls)).not.toContain(
      'private provider response',
    );
    expect(iterator.return).toHaveBeenCalledOnce();
    expect(iterator.return.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.release.mock.invocationCallOrder[0]!,
    );
  });

  it('bounds native iterator cleanup when return queues behind a stalled next call', async () => {
    const nextStarted = deferred<void>();
    const allowNext = deferred<void>();
    let iteratorFinalized = false;
    const iterator = (async function* () {
      try {
        nextStarted.resolve();
        await allowNext.promise;
        yield await Promise.reject<string>(
          new Error('private late next rejection'),
        );
      } finally {
        iteratorFinalized = true;
      }
    })();
    const returnIterator = vi.spyOn(iterator, 'return');
    let providerSignal: AbortSignal | undefined;
    const dependencies = createService({
      deadlineMilliseconds: 20,
      provider: {
        stream: (_input, signal) => {
          providerSignal = signal;
          return iterator;
        },
      },
    });
    const response = new StreamResponse();
    const pending = dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      response,
    );
    await nextStarted.promise;

    const settledWithinBound = await Promise.race([
      pending.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    const finalizedBeforeUnstall = iteratorFinalized;
    const eventsBeforeUnstall = events(response);
    const endCallsBeforeUnstall = response.endCalls;
    allowNext.resolve();
    await pending;
    await vi.waitFor(() => expect(iteratorFinalized).toBe(true));

    expect(settledWithinBound).toBe(true);
    expect(eventsBeforeUnstall.at(-1)).toEqual({
      type: 'error',
      data: {
        code: 'ASSISTANT_TIMEOUT',
        message: 'The assistant timed out. Please try again.',
      },
    });
    expect(
      eventsBeforeUnstall.some(
        (event) => (event as { type: string }).type === 'done',
      ),
    ).toBe(false);
    expect(endCallsBeforeUnstall).toBe(1);
    expect(providerSignal?.aborted).toBe(true);
    expect(returnIterator).toHaveBeenCalledOnce();
    expect(finalizedBeforeUnstall).toBe(false);
    await vi.waitFor(() => expect(dependencies.release).toHaveBeenCalledOnce());
  });

  it('releases promptly when delayed provider finalization succeeds after the response ends', async () => {
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
      deadlineMilliseconds: 20,
      provider: { stream: () => iterableFrom(iterator) },
    });
    const pending = dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      new StreamResponse(),
    );
    await nextStarted.promise;
    await pending;
    expect(dependencies.release).not.toHaveBeenCalled();

    allowReturn.resolve();

    await vi.waitFor(() =>
      expect(dependencies.release).toHaveBeenCalledExactlyOnceWith(lease),
    );
  });

  it('renews the token-owned lease while provider work remains active', async () => {
    vi.useFakeTimers();
    const nextStarted = deferred<void>();
    const allowCompletion = deferred<void>();
    const iterator = {
      next: vi.fn(async () => {
        nextStarted.resolve();
        await allowCompletion.promise;
        return { done: true as const, value: undefined };
      }),
      return: vi.fn(() =>
        Promise.resolve({ done: true as const, value: undefined }),
      ),
    };
    const dependencies = createService({
      leaseRenewalMilliseconds: 10,
      provider: { stream: () => iterableFrom(iterator) },
    });
    const pending = dependencies.service.chat(
      input,
      context,
      new RequestEvents(),
      new StreamResponse(),
    );
    await nextStarted.promise;

    await vi.advanceTimersByTimeAsync(10);
    expect(dependencies.renew).toHaveBeenCalledExactlyOnceWith(lease);

    allowCompletion.resolve();
    await pending;
    await vi.advanceTimersByTimeAsync(50);

    expect(dependencies.renew).toHaveBeenCalledTimes(1);
    expect(dependencies.release).toHaveBeenCalledExactlyOnceWith(lease);
  });

  it('aborts provider work and safely logs a lease renewal failure', async () => {
    vi.useFakeTimers();
    const nextStarted = deferred<void>();
    const iterator = {
      next: vi.fn(() => {
        nextStarted.resolve();
        return new Promise<IteratorResult<string>>((resolve) => {
          // The provider observes the same abort signal through its iterator.
          setTimeout(() => resolve({ done: true, value: undefined }), 1_000);
        });
      }),
      return: vi.fn(() =>
        Promise.resolve({ done: true as const, value: undefined }),
      ),
    };
    const dependencies = createService({
      leaseRenewalMilliseconds: 10,
      renew: vi.fn(() =>
        Promise.reject(new Error('safe-key opaque-token redis://private-host')),
      ),
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

    await vi.advanceTimersByTimeAsync(10);
    await pending;

    expect(events(response).at(-1)).toEqual({
      type: 'error',
      data: {
        code: 'ASSISTANT_PROVIDER_UNAVAILABLE',
        message: 'The assistant is temporarily unavailable. Please try again.',
      },
    });
    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_LEASE_RENEW_FAILED',
        requestId: 'request-1',
      },
      'Assistant lease renewal failed',
    );
    expect(JSON.stringify(dependencies.logError.mock.calls)).not.toContain(
      'private-host',
    );
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

  it('bounds disconnect cleanup and retains the lease when native return stays queued', async () => {
    const nextStarted = deferred<void>();
    const allowNext = deferred<void>();
    let iteratorFinalized = false;
    const iterator = (async function* () {
      try {
        nextStarted.resolve();
        await allowNext.promise;
        yield 'must not be written';
      } finally {
        iteratorFinalized = true;
        await Promise.reject(new Error('private late return rejection'));
      }
    })();
    const returnIterator = vi.spyOn(iterator, 'return');
    const dependencies = createService({
      provider: { stream: () => iterator },
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
    const settledWithinBound = await Promise.race([
      pending.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    const finalizedBeforeUnstall = iteratorFinalized;
    allowNext.resolve();
    await pending;
    await vi.waitFor(() => expect(iteratorFinalized).toBe(true));

    expect(settledWithinBound).toBe(true);
    expect(returnIterator).toHaveBeenCalledOnce();
    expect(finalizedBeforeUnstall).toBe(false);
    expect(
      events(response).map((event) => (event as { type: string }).type),
    ).toEqual(['sources']);
    expect(response.endCalls).toBe(0);
    expect(dependencies.release).not.toHaveBeenCalled();
  });

  it('stops renewal but leaves TTL cleanup when iterator finalization cannot be confirmed', async () => {
    vi.useFakeTimers();
    const nextStarted = deferred<void>();
    const iterator = {
      next: vi.fn(() => {
        nextStarted.resolve();
        return new Promise<IteratorResult<string>>(() => undefined);
      }),
      return: vi.fn(() =>
        Promise.reject(new Error('private iterator cleanup failure')),
      ),
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
    await vi.advanceTimersByTimeAsync(30_000);

    expect(iterator.return).toHaveBeenCalledOnce();
    expect(dependencies.renew).not.toHaveBeenCalled();
    expect(dependencies.release).not.toHaveBeenCalled();
    expect(dependencies.logError).toHaveBeenCalledWith(
      {
        code: 'ASSISTANT_PROVIDER_FINALIZATION_UNCONFIRMED',
        requestId: 'request-1',
      },
      'Assistant provider finalization was not confirmed',
    );
  });

  it('finalizes the iterator before lease release when a delta cannot be written', async () => {
    const response = new StreamResponse();
    const iterator = {
      next: vi.fn(() => {
        response.destroyed = true;
        return Promise.resolve({
          done: false as const,
          value: 'must not be written',
        });
      }),
      return: vi.fn(() =>
        Promise.resolve({ done: true as const, value: undefined }),
      ),
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

  it('contains a thrown SSE write after headers flush without a second terminal write', async () => {
    const response = new StreamResponse();
    const write = vi.spyOn(response, 'write');
    write.mockImplementationOnce((chunk) => {
      response.chunks.push(chunk);
      return true;
    });
    write.mockImplementationOnce(() => {
      throw new Error('EPIPE private socket detail');
    });
    const iterator = {
      next: vi
        .fn<() => Promise<IteratorResult<string>>>()
        .mockResolvedValueOnce({ done: false, value: 'first delta' })
        .mockResolvedValue({ done: true, value: undefined }),
      return: vi.fn(() =>
        Promise.resolve({ done: true as const, value: undefined }),
      ),
    };
    const dependencies = createService({
      provider: { stream: () => iterableFrom(iterator) },
    });

    await expect(
      dependencies.service.chat(input, context, new RequestEvents(), response),
    ).resolves.toBeUndefined();

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
    ]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(response.endCalls).toBe(0);
    expect(iterator.return).toHaveBeenCalledOnce();
    expect(dependencies.release).toHaveBeenCalledOnce();
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

    expect(dependencies.load).toHaveBeenCalledOnce();
    expect(dependencies.retrieve).toHaveBeenCalledOnce();
    expect(dependencies.providerInvoked).not.toHaveBeenCalled();
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
    expect(dependencies.providerInvoked).not.toHaveBeenCalled();
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
      release: vi.fn(() =>
        Promise.reject(new Error('safe-key opaque-token redis://private-host')),
      ),
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
