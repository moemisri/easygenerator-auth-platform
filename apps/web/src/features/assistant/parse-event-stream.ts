import {
  assistantSseEventSchema,
  type AssistantSseEvent,
} from '@easygenerator/contracts';

const SAFE_PROTOCOL_MESSAGE =
  'The assistant response could not be read safely. Please try again.';

export class AssistantProtocolError extends Error {
  constructor() {
    super(SAFE_PROTOCOL_MESSAGE);
    this.name = 'AssistantProtocolError';
  }
}

function protocolError(cause?: unknown): never {
  const error = new AssistantProtocolError();
  if (cause !== undefined) error.cause = cause;
  throw error;
}

function isAbortError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

class EventParser {
  private eventName: string | undefined;
  private dataLines: string[] = [];
  private sourcesSeen = false;
  private sourceCount = 0;
  private deltaSeen = false;
  private terminalSeen = false;

  pushLine(line: string): AssistantSseEvent | undefined {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return undefined;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') this.eventName = value;
    if (field === 'data') this.dataLines.push(value);
    return undefined;
  }

  finish(): AssistantSseEvent | undefined {
    const event = this.dispatch();
    if (!this.terminalSeen) protocolError();
    return event;
  }

  private dispatch(): AssistantSseEvent | undefined {
    if (this.eventName === undefined && this.dataLines.length === 0) {
      return undefined;
    }

    const eventName = this.eventName;
    const eventData = this.dataLines.join('\n');
    this.eventName = undefined;
    this.dataLines = [];

    if (!eventName || eventData === '') protocolError();

    let payload: unknown;
    try {
      payload = JSON.parse(eventData);
    } catch (error) {
      protocolError(error);
    }

    const result = assistantSseEventSchema.safeParse({
      type: eventName,
      data: payload,
    });
    if (!result.success) protocolError(result.error);

    const event = result.data;
    this.assertOrder(event);
    return event;
  }

  private assertOrder(event: AssistantSseEvent) {
    if (this.terminalSeen) protocolError();

    switch (event.type) {
      case 'sources':
        if (this.sourcesSeen) protocolError();
        this.sourcesSeen = true;
        this.sourceCount = event.data.sources.length;
        return;
      case 'delta':
        if (!this.sourcesSeen || this.sourceCount === 0) protocolError();
        this.deltaSeen = true;
        return;
      case 'done':
        if (!this.sourcesSeen) protocolError();
        if (
          (event.data.outcome === 'refused' &&
            (this.sourceCount !== 0 || this.deltaSeen)) ||
          (event.data.outcome === 'answered' && this.sourceCount === 0)
        ) {
          protocolError();
        }
        this.terminalSeen = true;
        return;
      case 'error':
        this.terminalSeen = true;
    }
  }
}

export async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistantSseEvent, void, undefined> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parser = new EventParser();
  let buffer = '';

  function* drainLines(atEof: boolean) {
    while (buffer.length > 0) {
      const lf = buffer.indexOf('\n');
      const cr = buffer.indexOf('\r');
      const newline = lf === -1 ? cr : cr === -1 ? lf : Math.min(lf, cr);

      if (newline === -1) break;
      if (buffer[newline] === '\r' && newline === buffer.length - 1 && !atEof) {
        break;
      }

      const line = buffer.slice(0, newline);
      const width =
        buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(newline + width);
      const event = parser.pushLine(line);
      if (event) yield event;
    }

    if (atEof && buffer.length > 0) {
      const event = parser.pushLine(buffer);
      buffer = '';
      if (event) yield event;
    }
  }

  try {
    const reader = body.getReader();
    let completed = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        yield* drainLines(false);
      }
      buffer += decoder.decode();
      yield* drainLines(true);
      const finalEvent = parser.finish();
      completed = true;
      if (finalEvent) yield finalEvent;
    } finally {
      if (!completed) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the parser/read failure that caused cancellation.
        }
      }
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof AssistantProtocolError || isAbortError(error)) {
      throw error;
    }
    protocolError(error);
  }
}
