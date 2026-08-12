import { describe, expect, it } from 'vitest';

import {
  assistantChatRequestSchema,
  assistantSseEventSchema,
} from './assistant.js';

describe('assistantChatRequestSchema', () => {
  it('parses a trimmed message with a default empty history', () => {
    expect(
      assistantChatRequestSchema.parse({ message: '  Explain sessions  ' }),
    ).toEqual({ message: 'Explain sessions', history: [] });
  });

  it.each([
    ['unknown body field', { message: 'Explain sessions', tools: [] }],
    ['empty message', { message: '   ' }],
    ['overlong message', { message: 'm'.repeat(1_001) }],
    [
      'more than six history entries',
      {
        message: 'Explain sessions',
        history: Array.from({ length: 7 }, () => ({
          role: 'user',
          content: 'question',
        })),
      },
    ],
    [
      'unknown history field',
      {
        message: 'Explain sessions',
        history: [{ role: 'user', content: 'question', system: true }],
      },
    ],
    [
      'client-supplied model role',
      {
        message: 'Explain sessions',
        history: [{ role: 'model', content: 'answer' }],
      },
    ],
    [
      'empty history content',
      {
        message: 'Explain sessions',
        history: [{ role: 'assistant', content: '   ' }],
      },
    ],
    [
      'overlong history item',
      {
        message: 'Explain sessions',
        history: [{ role: 'assistant', content: 'a'.repeat(1_001) }],
      },
    ],
  ])('rejects %s', (_case, input) => {
    expect(assistantChatRequestSchema.safeParse(input).success).toBe(false);
  });

  it('accepts exactly 6,000 history characters', () => {
    const parsed = assistantChatRequestSchema.safeParse({
      message: 'Explain sessions',
      history: Array.from({ length: 6 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: String(index).repeat(1_000),
      })),
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects 6,001 total history characters', () => {
    expect(() =>
      assistantChatRequestSchema.parse({
        message: 'Explain sessions',
        history: [
          ...Array.from({ length: 5 }, (_, index) => ({
            role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
            content: String(index).repeat(1_000),
          })),
          { role: 'user', content: 'z'.repeat(1_001) },
        ],
      }),
    ).toThrow('History is too long.');
  });
});

describe('assistantSseEventSchema', () => {
  it.each([
    {
      type: 'sources',
      data: {
        sources: [{ id: 'chunk-1', file: 'overview.md', heading: 'Overview' }],
      },
    },
    { type: 'delta', data: { text: 'Sessions are stored server-side.' } },
    { type: 'done', data: { outcome: 'answered' } },
    { type: 'done', data: { outcome: 'refused' } },
    {
      type: 'error',
      data: {
        code: 'ASSISTANT_TIMEOUT',
        message: 'The assistant timed out. Please try again.',
      },
    },
    {
      type: 'error',
      data: {
        code: 'ASSISTANT_PROVIDER_UNAVAILABLE',
        message: 'The assistant is temporarily unavailable. Please try again.',
      },
    },
  ])('accepts the $type event shape', (event) => {
    expect(assistantSseEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    [
      'more than four sources',
      {
        type: 'sources',
        data: {
          sources: Array.from({ length: 5 }, (_, index) => ({
            id: String(index),
            file: 'overview.md',
            heading: 'Overview',
          })),
        },
      },
    ],
    [
      'blank source descriptor',
      {
        type: 'sources',
        data: {
          sources: [{ id: '', file: 'overview.md', heading: 'Overview' }],
        },
      },
    ],
    ['empty delta', { type: 'delta', data: { text: '' } }],
    [
      'unrecognized terminal outcome',
      { type: 'done', data: { outcome: 'failed' } },
    ],
    [
      'unrecognized safe error code',
      { type: 'error', data: { code: 'SDK_ERROR', message: 'details' } },
    ],
    [
      'unknown event field',
      { type: 'done', data: { outcome: 'answered' }, provider: 'gemini' },
    ],
    [
      'unknown event data field',
      { type: 'delta', data: { text: 'safe', raw: 'unsafe' } },
    ],
  ])('rejects %s', (_case, event) => {
    expect(assistantSseEventSchema.safeParse(event).success).toBe(false);
  });
});
