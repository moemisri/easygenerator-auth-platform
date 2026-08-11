import type {
  AssistantHistoryItem,
  AssistantSource,
} from '@easygenerator/contracts';

export interface CorpusChunk {
  id: string;
  file: string;
  heading: string;
  content: string;
}

export interface AssistantCorpus {
  digest: string;
  chunks: CorpusChunk[];
}

export interface RetrievedChunk extends CorpusChunk {
  coverage: number;
}

export const MAX_SELECTED_EXCERPT_CHARACTERS = 12_000;

export type RetrievalResult =
  | {
      kind: 'answer';
      normalizedQuery: string;
      chunks: RetrievedChunk[];
    }
  | {
      kind: 'refusal';
      normalizedQuery: string;
      reason: 'INSUFFICIENT_DOCUMENTATION';
    };

export interface AssistantProviderInput {
  system: string;
  contents: string;
  maxOutputTokens: number;
}

export interface AssistantProvider {
  stream(
    input: AssistantProviderInput,
    signal: AbortSignal,
  ): AsyncIterable<string>;
}

export interface AssistantStreamInput {
  message: string;
  history: AssistantHistoryItem[];
}

export interface AssistantStreamContext {
  requestId: string;
  userId: string;
}

export interface AssistantStreamResponse extends AssistantRequestEvents {
  destroyed: boolean;
  headersSent: boolean;
  setHeader(name: string, value: string): void;
  flushHeaders(): void;
  write(chunk: string): boolean;
  end(): void;
}

export interface AssistantRequestEvents {
  on(event: 'close', listener: () => void): void;
  off(event: 'close', listener: () => void): void;
}

export function sourceForChunk(chunk: CorpusChunk): AssistantSource {
  return { id: chunk.id, file: chunk.file, heading: chunk.heading };
}

export const ASSISTANT_PROVIDER = Symbol('ASSISTANT_PROVIDER');
