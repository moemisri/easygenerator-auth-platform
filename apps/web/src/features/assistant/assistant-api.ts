import {
  assistantChatRequestSchema,
  problemDetailsSchema,
  type AssistantChatRequest,
} from '@easygenerator/contracts';

import { ApiProblem } from '../../lib/api-client';
import { publishAuthExpiry } from '../auth/auth-expiry';
import { AssistantProtocolError } from './parse-event-stream';

const MAX_RETRY_AFTER_SECONDS = 300;

function retryAfterSeconds(value: string | null): number | undefined {
  if (value === null || !/^[1-9]\d*$/.test(value)) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return undefined;
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
}

async function cancelBody(response: Response) {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Preserve the safe response error if disposal itself fails.
  }
}

function mediaType(value: string | null) {
  return value?.split(';', 1)[0]?.trim().toLowerCase();
}

async function parseProblem(response: Response) {
  let payload: unknown;
  if ((response.headers.get('Content-Type') ?? '').includes('json')) {
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
  } else {
    await cancelBody(response);
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

  if (!response.ok) {
    const problem = await parseProblem(response);
    if (response.status === 401) publishAuthExpiry();
    throw problem;
  }

  if (!response.body) {
    throw new AssistantProtocolError();
  }
  if (mediaType(response.headers.get('Content-Type')) !== 'text/event-stream') {
    await cancelBody(response);
    throw new AssistantProtocolError();
  }
  return response.body;
}
