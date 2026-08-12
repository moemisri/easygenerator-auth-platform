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

function truncateAtUtf16Boundary(content: string, limit: number): string {
  let truncated = content.slice(0, limit);
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

export function fitExcerptChunks<T extends CorpusChunk>(chunks: T[]): T[] {
  const selected = chunks.slice(0, 4);
  let characters = selected.reduce(
    (sum, chunk) => sum + chunk.content.length,
    0,
  );
  while (selected.length > 1 && characters > MAX_SELECTED_EXCERPT_CHARACTERS) {
    const removed = selected.pop();
    if (removed !== undefined) characters -= removed.content.length;
  }
  const top = selected[0];
  if (
    top !== undefined &&
    top.content.length > MAX_SELECTED_EXCERPT_CHARACTERS
  ) {
    selected[0] = {
      ...top,
      content: truncateAtUtf16Boundary(
        top.content,
        MAX_SELECTED_EXCERPT_CHARACTERS,
      ),
    };
  }
  return selected;
}

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
  requestIp: string;
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
