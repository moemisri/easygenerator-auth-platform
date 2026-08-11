import { describe, expect, it } from 'vitest';

import { encodeSse } from './sse-writer';

describe('encodeSse', () => {
  it('frames a validated JSON event', () => {
    expect(
      encodeSse({
        type: 'sources',
        data: {
          sources: [
            { id: 'chunk-1', file: 'overview.md', heading: 'Overview' },
          ],
        },
      }),
    ).toBe(
      'event: sources\ndata: {"sources":[{"id":"chunk-1","file":"overview.md","heading":"Overview"}]}\n\n',
    );
  });

  it('JSON-escapes newlines so model text cannot inject another event', () => {
    expect(
      encodeSse({
        type: 'delta',
        data: { text: 'hello\n\ndata: forged\n\nevent: done' },
      }),
    ).toBe(
      'event: delta\ndata: {"text":"hello\\n\\ndata: forged\\n\\nevent: done"}\n\n',
    );
  });
});
