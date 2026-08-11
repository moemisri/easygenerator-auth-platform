import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import {
  GeminiProvider,
  type GoogleGenAiClient,
  type GoogleGenAiFactory,
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

describe('GeminiProvider', () => {
  it('constructs lazily and streams text through the configured model', async () => {
    const requests: unknown[] = [];
    const generateContentStream = vi.fn(async (request: unknown) => {
      requests.push(request);
      return (async function* () {
        yield { text: 'Session ' };
        yield { text: '' };
        yield { text: 'details.' };
      })();
    });
    const factory = vi.fn<GoogleGenAiFactory>(
      () =>
        ({
          models: { generateContentStream },
        }) as GoogleGenAiClient,
    );
    const provider = new GeminiProvider(
      config({ GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-test' }),
      factory,
    );
    const abort = new AbortController();
    const iterable = provider.stream(
      {
        system: 'Static grounding instruction.',
        contents: 'Bounded conversation and excerpts.',
        maxOutputTokens: 800,
      },
      abort.signal,
    );

    expect(factory).not.toHaveBeenCalled();
    const chunks: string[] = [];
    for await (const text of iterable) chunks.push(text);

    expect(chunks).toEqual(['Session ', 'details.']);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith('unit-test-key');
    expect(generateContentStream).toHaveBeenCalledOnce();
    expect(requests).toEqual([
      {
        model: 'gemini-test',
        contents: 'Bounded conversation and excerpts.',
        config: {
          maxOutputTokens: 800,
          systemInstruction: 'Static grounding instruction.',
          tools: [],
          abortSignal: abort.signal,
        },
      },
    ]);
    expect(requests[0]).not.toHaveProperty('abortSignal');
  });

  it('passes the live abort signal to the SDK request config', async () => {
    let observedSignal: AbortSignal | undefined;
    const factory: GoogleGenAiFactory = () => ({
      models: {
        generateContentStream: async (request) => {
          observedSignal = request.config?.abortSignal;
          return (async function* () {
            yield { text: 'started' };
          })();
        },
      },
    });
    const provider = new GeminiProvider(
      config({ GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-test' }),
      factory,
    );
    const abort = new AbortController();

    const iterator = provider
      .stream(
        {
          system: 'Static grounding instruction.',
          contents: 'Bounded conversation and excerpts.',
          maxOutputTokens: 800,
        },
        abort.signal,
      )
      [Symbol.asyncIterator]();
    await iterator.next();
    abort.abort();

    expect(observedSignal).toBe(abort.signal);
    expect(observedSignal?.aborted).toBe(true);
  });
});
