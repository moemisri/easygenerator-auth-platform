import { ApiError } from '@google/genai';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GeminiProvider,
  type GoogleGenAiClient,
  type GoogleGenAiFactory,
  type GoogleStreamRequest,
} from './gemini.provider';

function config(values: Record<string, string>): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing ${key}`);
      return value;
    },
  } as ConfigService;
}

const providerInput = {
  system: 'Static grounding instruction.',
  contents: 'Bounded conversation and excerpts.',
  maxOutputTokens: 800,
};

interface GoogleChunk {
  text?: string;
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

function asyncSequence<T>(...steps: Array<T | Error>): AsyncIterable<T> {
  let index = 0;
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const step = steps[index];
        index += 1;
        if (step instanceof Error) return Promise.reject(step);
        return Promise.resolve(
          step === undefined
            ? { done: true as const, value: undefined }
            : { done: false as const, value: step },
        );
      },
    }),
  };
}

describe('GeminiProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('constructs lazily and streams text through the configured model', async () => {
    const requests: unknown[] = [];
    const generateContentStream = vi.fn((request: GoogleStreamRequest) => {
      requests.push(request);
      return Promise.resolve(
        asyncSequence<GoogleChunk>(
          { text: 'Session ' },
          { text: '' },
          { text: 'details.' },
        ),
      );
    });
    const factory = vi.fn<GoogleGenAiFactory>(() => ({
      models: { generateContentStream },
    }));
    const provider = new GeminiProvider(
      config({ GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-test' }),
      factory,
    );
    const abort = new AbortController();
    const iterable = provider.stream(providerInput, abort.signal);

    expect(factory).not.toHaveBeenCalled();
    const chunks: string[] = [];
    for await (const text of iterable) chunks.push(text);

    expect(chunks).toEqual(['Session ', 'details.']);
    expect(factory).toHaveBeenCalledExactlyOnceWith('unit-test-key');
    expect(generateContentStream).toHaveBeenCalledOnce();
    expect(requests).toEqual([
      {
        model: 'gemini-test',
        contents: 'Bounded conversation and excerpts.',
        config: {
          maxOutputTokens: 800,
          systemInstruction: 'Static grounding instruction.',
          tools: [],
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: abort.signal,
        },
      },
    ]);
    expect(requests[0]).not.toHaveProperty('abortSignal');
  });

  it('reuses one lazily constructed client across provider streams', async () => {
    const generateContentStream = vi.fn(() =>
      Promise.resolve(asyncSequence({ text: 'answer' })),
    );
    const factory = vi.fn<GoogleGenAiFactory>(() => ({
      models: { generateContentStream },
    }));
    const provider = new GeminiProvider(
      config({ GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-test' }),
      factory,
    );

    await collect(provider.stream(providerInput, new AbortController().signal));
    await collect(provider.stream(providerInput, new AbortController().signal));

    expect(factory).toHaveBeenCalledOnce();
    expect(generateContentStream).toHaveBeenCalledTimes(2);
  });

  it('retries transient setup and pre-output stream failures with bounded backoff', async () => {
    vi.useFakeTimers();
    const generateContentStream = vi
      .fn<GoogleGenAiClient['models']['generateContentStream']>()
      .mockRejectedValueOnce(
        new ApiError({ message: 'private transient setup', status: 503 }),
      )
      .mockResolvedValueOnce(
        asyncSequence<GoogleChunk>(
          new ApiError({
            message: 'private transient first read',
            status: 429,
          }),
        ),
      )
      .mockResolvedValueOnce(asyncSequence({ text: 'recovered' }));
    const provider = new GeminiProvider(
      config({ GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-test' }),
      () => ({ models: { generateContentStream } }),
    );

    const result = collect(
      provider.stream(providerInput, new AbortController().signal),
    );
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual(['recovered']);
    expect(generateContentStream).toHaveBeenCalledTimes(3);
  });

  it('never retries a transient provider failure after output begins', async () => {
    const generateContentStream = vi.fn(() =>
      Promise.resolve(
        asyncSequence<GoogleChunk>(
          { text: 'visible chunk' },
          new ApiError({ message: 'private late failure', status: 503 }),
        ),
      ),
    );
    const provider = new GeminiProvider(
      config({ GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-test' }),
      () => ({ models: { generateContentStream } }),
    );

    await expect(
      collect(provider.stream(providerInput, new AbortController().signal)),
    ).rejects.toBeInstanceOf(ApiError);
    expect(generateContentStream).toHaveBeenCalledOnce();
  });

  it('does not retry a permanent provider failure before output', async () => {
    const generateContentStream = vi.fn(() =>
      Promise.reject(
        new ApiError({ message: 'private permanent failure', status: 400 }),
      ),
    );
    const provider = new GeminiProvider(
      config({ GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-test' }),
      () => ({ models: { generateContentStream } }),
    );

    await expect(
      collect(provider.stream(providerInput, new AbortController().signal)),
    ).rejects.toBeInstanceOf(ApiError);
    expect(generateContentStream).toHaveBeenCalledOnce();
  });

  it('aborts during retry backoff without starting another provider call', async () => {
    vi.useFakeTimers();
    const generateContentStream = vi.fn(() =>
      Promise.reject(
        new ApiError({ message: 'private transient failure', status: 503 }),
      ),
    );
    const provider = new GeminiProvider(
      config({ GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-test' }),
      () => ({ models: { generateContentStream } }),
    );
    const abort = new AbortController();
    const result = collect(provider.stream(providerInput, abort.signal));
    await vi.waitFor(() =>
      expect(generateContentStream).toHaveBeenCalledOnce(),
    );

    abort.abort();

    await expect(result).rejects.toThrow('Assistant provider aborted');
    expect(generateContentStream).toHaveBeenCalledOnce();
  });

  it('passes the live abort signal to the SDK request config', async () => {
    let observedSignal: AbortSignal | undefined;
    const factory: GoogleGenAiFactory = () => ({
      models: {
        generateContentStream: (request) => {
          observedSignal = request.config?.abortSignal;
          return Promise.resolve(asyncSequence({ text: 'started' }));
        },
      },
    });
    const provider = new GeminiProvider(
      config({ GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-test' }),
      factory,
    );
    const abort = new AbortController();

    const iterator = provider
      .stream(providerInput, abort.signal)
      [Symbol.asyncIterator]();
    await iterator.next();
    abort.abort();

    expect(observedSignal).toBe(abort.signal);
    expect(observedSignal?.aborted).toBe(true);
  });
});
