import {
  assistantChatRequestSchema,
  problemDetailsSchema,
  type AssistantChatRequest,
} from '@easygenerator/contracts';

import { ApiProblem } from '../../lib/api-client';
import { AssistantProtocolError } from './parse-event-stream';

const MAX_RETRY_AFTER_SECONDS = 300;

function retryAfterSeconds(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
}

async function parseProblem(response: Response) {
  let payload: unknown;
  if ((response.headers.get('Content-Type') ?? '').includes('json')) {
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
  }

  const parsed = problemDetailsSchema.safeParse(payload);
  const problem = parsed.success ? parsed.data : undefined;
  return new ApiProblem(
    response.status,
    problem?.title ?? 'Request failed',
    problem?.code,
    problem?.requestId,
    retryAfterSeconds(response.headers.get('Retry-After')),
    problem?.detail,
    problem?.instance,
    problem?.fields,
  );
}

export async function openAssistantStream(
  input: AssistantChatRequest,
  csrfToken: string,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const request = assistantChatRequestSchema.parse(input);
  const response = await fetch('/api/v1/assistant/chat', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) throw await parseProblem(response);

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!response.body) {
    throw new AssistantProtocolError();
  }
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    void response.body.cancel().catch(() => {
      // The safe protocol error remains authoritative if cancellation fails.
    });
    throw new AssistantProtocolError();
  }
  return response.body;
}
