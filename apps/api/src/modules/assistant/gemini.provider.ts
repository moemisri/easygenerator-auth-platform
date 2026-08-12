import { GoogleGenAI } from '@google/genai';
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

@Injectable()
export class GeminiProvider implements AssistantProvider {
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
    const client = this.createClient(
      this.config.getOrThrow<string>('GEMINI_API_KEY'),
    );
    const stream = await client.models.generateContentStream({
      model: this.config.getOrThrow<string>('GEMINI_MODEL'),
      contents: input.contents,
      config: {
        maxOutputTokens: input.maxOutputTokens,
        systemInstruction: input.system,
        tools: [],
        abortSignal: signal,
      },
    });
    for await (const chunk of stream) {
      if (typeof chunk.text === 'string' && chunk.text.length > 0) {
        yield chunk.text;
      }
    }
  }
}
