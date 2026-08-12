import { ApiError, GoogleGenAI } from '@google/genai';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  AssistantProvider,
  AssistantProviderInput,
} from './assistant.types.js';

export const GOOGLE_GENAI_FACTORY = Symbol('GOOGLE_GENAI_FACTORY');

export interface GoogleStreamRequest {
  model: string;
  contents: string;
  config: {
    maxOutputTokens: number;
    systemInstruction: string;
    tools: [];
    thinkingConfig: { thinkingBudget: number };
    abortSignal: AbortSignal;
  };
}

export interface GoogleGenAiClient {
  models: {
    generateContentStream(
      request: GoogleStreamRequest,
    ): Promise<AsyncIterable<{ text?: string }>>;
  };
}

export type GoogleGenAiFactory = (apiKey: string) => GoogleGenAiClient;

export const googleGenAiFactory: GoogleGenAiFactory = (apiKey) =>
  new GoogleGenAI({ apiKey }) as GoogleGenAiClient;

const TRANSIENT_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_BACKOFF_MILLISECONDS = [100, 200] as const;

function providerAborted(): Error {
  const error = new Error('Assistant provider aborted');
  error.name = 'AbortError';
  return error;
}

function isTransientProviderFailure(error: unknown): boolean {
  return (
    error instanceof ApiError && TRANSIENT_PROVIDER_STATUSES.has(error.status)
  );
}

function waitForRetry(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(providerAborted());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(providerAborted());
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

@Injectable()
export class GeminiProvider implements AssistantProvider {
  private client: GoogleGenAiClient | undefined;

  constructor(
    private readonly config: ConfigService,
    @Inject(GOOGLE_GENAI_FACTORY)
    private readonly createClient: GoogleGenAiFactory,
  ) {}

  stream(
    input: AssistantProviderInput,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    return this.streamFromGoogle(input, signal);
  }

  private async *streamFromGoogle(
    input: AssistantProviderInput,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted) throw providerAborted();
      let outputStarted = false;
      try {
        const stream = await this.getClient().models.generateContentStream({
          model: this.config.getOrThrow<string>('GEMINI_MODEL'),
          contents: input.contents,
          config: {
            maxOutputTokens: input.maxOutputTokens,
            systemInstruction: input.system,
            tools: [],
            // Gemini 2.5 models think by default and charge those tokens
            // against maxOutputTokens. At this budget the model can spend the
            // whole allowance thinking and stream back no text at all, which
            // surfaces as an empty answer rather than an error.
            thinkingConfig: { thinkingBudget: 0 },
            abortSignal: signal,
          },
        });
        for await (const chunk of stream) {
          if (typeof chunk.text === 'string' && chunk.text.length > 0) {
            outputStarted = true;
            yield chunk.text;
          }
        }
        return;
      } catch (error) {
        const backoff = RETRY_BACKOFF_MILLISECONDS[attempt];
        if (
          outputStarted ||
          signal.aborted ||
          backoff === undefined ||
          !isTransientProviderFailure(error)
        ) {
          throw signal.aborted ? providerAborted() : error;
        }
        await waitForRetry(backoff, signal);
      }
    }
  }

  private getClient(): GoogleGenAiClient {
    return (this.client ??= this.createClient(
      this.config.getOrThrow<string>('GEMINI_API_KEY'),
    ));
  }
}
