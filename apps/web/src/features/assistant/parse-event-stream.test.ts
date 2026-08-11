import type { AssistantSseEvent } from '@easygenerator/contracts';
import { describe, expect, it, vi } from 'vitest';

import { AssistantProtocolError, parseEventStream } from './parse-event-stream';

const source = {
  id: 'overview:introduction',
  file: 'docs/assistant-public/overview.md',
  heading: 'Introduction',
};

function streamOf(chunks: Array<string | Uint8Array>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const events: AssistantSseEvent[] = [];
  for await (const event of parseEventStream(body)) events.push(event);
  return events;
}

describe('parseEventStream', () => {
  it('reassembles fields, delimiters, JSON, and UTF-8 split across chunks', async () => {
    const wire =
      `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\n` +
      `event: delta\ndata: ${JSON.stringify({ text: 'Café ✓' })}\n\n` +
      'event: done\ndata: {"outcome":"answered"}\n\n';
    const bytes = new TextEncoder().encode(wire);
    const checkmark = new TextEncoder().encode('✓');
    const checkmarkStart = bytes.findIndex((value, index) =>
      checkmark.every((part, offset) => bytes[index + offset] === part),
    );

    await expect(
      collect(
        streamOf([
          bytes.slice(0, 4),
          bytes.slice(4, 15),
          bytes.slice(15, checkmarkStart + 1),
          bytes.slice(checkmarkStart + 1, checkmarkStart + 2),
          bytes.slice(checkmarkStart + 2),
        ]),
      ),
    ).resolves.toEqual([
      { type: 'sources', data: { sources: [source] } },
      { type: 'delta', data: { text: 'Café ✓' } },
      { type: 'done', data: { outcome: 'answered' } },
    ]);
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['lone CR', '\r'],
  ])(
    'accepts %s framing and ignores comments and other fields',
    async (_, eol) => {
      const wire = [
        ': keep-alive',
        'retry: 1000',
        'event: sources',
        `data: ${JSON.stringify({ sources: [source] })}`,
        '',
        'event: done',
        'data: {"outcome":"answered"}',
        '',
      ].join(eol);

      await expect(collect(streamOf([wire]))).resolves.toEqual([
        { type: 'sources', data: { sources: [source] } },
        { type: 'done', data: { outcome: 'answered' } },
      ]);
    },
  );

  it('parses multiple events in one chunk and a final event without a blank line', async () => {
    await expect(
      collect(
        streamOf([
          `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\n` +
            'event: delta\ndata: {"text":"One"}\n\n' +
            'event: delta\ndata: {"text":" two"}\n\n' +
            'event: done\ndata: {"outcome":"answered"}',
        ]),
      ),
    ).resolves.toEqual([
      { type: 'sources', data: { sources: [source] } },
      { type: 'delta', data: { text: 'One' } },
      { type: 'delta', data: { text: ' two' } },
      { type: 'done', data: { outcome: 'answered' } },
    ]);
  });

  it('joins multiple data fields before parsing JSON', async () => {
    await expect(
      collect(
        streamOf([
          'event: sources\n' +
            `data: {"sources":[${JSON.stringify(source)}\n` +
            'data: ]}\n\n' +
            'event: done\ndata: {"outcome":"answered"}\n\n',
        ]),
      ),
    ).resolves.toEqual([
      { type: 'sources', data: { sources: [source] } },
      { type: 'done', data: { outcome: 'answered' } },
    ]);
  });

  it('preserves JSON escapes in delta text', async () => {
    await expect(
      collect(
        streamOf([
          `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\n` +
            `event: delta\ndata: {"text":"Line one\\n\\"quoted\\""}\n\n` +
            'event: done\ndata: {"outcome":"answered"}\n\n',
        ]),
      ),
    ).resolves.toEqual([
      { type: 'sources', data: { sources: [source] } },
      { type: 'delta', data: { text: 'Line one\n"quoted"' } },
      { type: 'done', data: { outcome: 'answered' } },
    ]);
  });

  it.each([
    [
      'an unknown event',
      'event: mystery\ndata: {}\n\n' +
        'event: error\ndata: {"code":"ASSISTANT_TIMEOUT","message":"Timed out."}\n\n',
    ],
    ['malformed JSON', 'event: sources\ndata: {nope}\n\n'],
    [
      'an unknown payload field',
      'event: sources\ndata: {"sources":[],"secret":"no"}\n\n' +
        'event: done\ndata: {"outcome":"refused"}\n\n',
    ],
    [
      'an invalid source descriptor',
      'event: sources\ndata: {"sources":[{"id":"x","file":"x"}]}\n\n' +
        'event: done\ndata: {"outcome":"answered"}\n\n',
    ],
    [
      'an empty delta',
      `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\n` +
        'event: delta\ndata: {"text":""}\n\n' +
        'event: done\ndata: {"outcome":"answered"}\n\n',
    ],
    [
      'an unsafe error payload',
      'event: error\ndata: {"code":"INTERNAL","message":"stack"}\n\n',
    ],
  ])('rejects %s with a safe protocol error', async (_, wire) => {
    await expect(collect(streamOf([wire]))).rejects.toBeInstanceOf(
      AssistantProtocolError,
    );
  });

  it('rejects malformed UTF-8 instead of replacing it', async () => {
    await expect(
      collect(streamOf([new Uint8Array([0x65, 0x76, 0x65, 0x6e, 0x74, 0xc3])])),
    ).rejects.toBeInstanceOf(AssistantProtocolError);
  });

  it('preserves AbortError from a pending stream read', async () => {
    const abortController = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        abortController.signal.addEventListener(
          'abort',
          () => controller.error(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      },
    });
    const pending = collect(body);

    abortController.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancels an open underlying stream after a malformed first frame', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('event: sources\ndata: {malformed}\n\n'),
        );
      },
      cancel,
    });

    await expect(collect(body)).rejects.toBeInstanceOf(AssistantProtocolError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'delta before sources',
      'event: delta\ndata: {"text":"No"}\n\nevent: error\ndata: {"code":"ASSISTANT_TIMEOUT","message":"Timed out."}\n\n',
    ],
    ['done before sources', 'event: done\ndata: {"outcome":"answered"}\n\n'],
    [
      'duplicate sources',
      'event: sources\ndata: {"sources":[]}\n\nevent: sources\ndata: {"sources":[]}\n\nevent: done\ndata: {"outcome":"refused"}\n\n',
    ],
    [
      'a delta for a refusal stream',
      'event: sources\ndata: {"sources":[]}\n\nevent: delta\ndata: {"text":"No"}\n\nevent: done\ndata: {"outcome":"refused"}\n\n',
    ],
    [
      'refused after prose',
      `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\n` +
        'event: delta\ndata: {"text":"No"}\n\nevent: done\ndata: {"outcome":"refused"}\n\n',
    ],
    [
      'answered without grounding sources',
      'event: sources\ndata: {"sources":[]}\n\nevent: done\ndata: {"outcome":"answered"}\n\n',
    ],
    [
      'done after error',
      'event: error\ndata: {"code":"ASSISTANT_TIMEOUT","message":"Timed out."}\n\nevent: done\ndata: {"outcome":"answered"}\n\n',
    ],
    [
      'an event after done',
      'event: sources\ndata: {"sources":[]}\n\nevent: done\ndata: {"outcome":"refused"}\n\nevent: error\ndata: {"code":"ASSISTANT_TIMEOUT","message":"Timed out."}\n\n',
    ],
    [
      'EOF without a terminal event',
      `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\n`,
    ],
  ])('rejects illegal order: %s', async (_, wire) => {
    await expect(collect(streamOf([wire]))).rejects.toBeInstanceOf(
      AssistantProtocolError,
    );
  });

  it.each([
    [
      'a source-first answered stream',
      `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\n` +
        'event: done\ndata: {"outcome":"answered"}\n\n',
    ],
    [
      'a zero-delta refusal',
      'event: sources\ndata: {"sources":[]}\n\nevent: done\ndata: {"outcome":"refused"}\n\n',
    ],
    [
      'an early terminal error',
      'event: error\ndata: {"code":"ASSISTANT_PROVIDER_UNAVAILABLE","message":"Assistant unavailable."}\n\n',
    ],
    [
      'an error after sources',
      `event: sources\ndata: ${JSON.stringify({ sources: [source] })}\n\n` +
        'event: error\ndata: {"code":"ASSISTANT_TIMEOUT","message":"Timed out."}\n\n',
    ],
  ])('accepts %s', async (_, wire) => {
    await expect(collect(streamOf([wire]))).resolves.not.toHaveLength(0);
  });
});
