import { describe, expect, it } from 'vitest';

import type { AssistantCorpus, CorpusChunk } from './assistant.types';
import {
  normalizeMeaningfulTerms,
  RetrieverService,
} from './retriever.service';

function chunk(
  id: string,
  heading: string,
  content: string,
  file = 'overview.md',
): CorpusChunk {
  return { id, file, heading, content };
}

function corpus(chunks: CorpusChunk[]): AssistantCorpus {
  return { digest: 'corpus-digest', chunks };
}

describe('normalizeMeaningfulTerms', () => {
  it('uses NFKC Unicode tokens, removes fixed stop words, and deduplicates first-seen terms', () => {
    expect(
      normalizeMeaningfulTerms('The CAFÉ café, １２３ and Sessions sessions'),
    ).toEqual(['café', '123', 'sessions']);
  });
});

describe('RetrieverService', () => {
  const retriever = new RetrieverService();

  it('accepts a one-term query only when the term is a heading token', () => {
    const result = retriever.search(
      corpus([
        chunk('heading', 'Authentication', '# Authentication\nUses sessions.'),
        chunk('body', 'Overview', '# Overview\nAuthentication is supported.'),
      ]),
      'authentication',
    );

    expect(result.kind).toBe('answer');
    if (result.kind === 'answer') {
      expect(result.chunks.map(({ id }) => id)).toEqual(['heading', 'body']);
    }
  });

  it('refuses a one-term query found only in body text', () => {
    expect(
      retriever.search(
        corpus([
          chunk('body', 'Overview', '# Overview\nAuthentication is supported.'),
        ]),
        'authentication',
      ),
    ).toEqual({
      kind: 'refusal',
      normalizedQuery: 'authentication',
      reason: 'INSUFFICIENT_DOCUMENTATION',
    });
  });

  it('accepts exactly 40 percent multi-term coverage', () => {
    const result = retriever.search(
      corpus([
        chunk('eligible', 'Overview', '# Overview\nalpha beta documented.'),
      ]),
      'alpha beta gamma delta epsilon',
    );

    expect(result.kind).toBe('answer');
    if (result.kind === 'answer') {
      expect(result.chunks[0]?.coverage).toBe(0.4);
    }
  });

  it('refuses coverage below 40 percent', () => {
    expect(
      retriever.search(
        corpus([
          chunk(
            'weak',
            'Overview',
            '# Overview\none two three four five six seven.',
          ),
        ]),
        'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen',
      ),
    ).toEqual({
      kind: 'refusal',
      normalizedQuery:
        'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen',
      reason: 'INSUFFICIENT_DOCUMENTATION',
    });
  });

  it('sorts ties by chunk ID and returns at most four chunks', () => {
    const result = retriever.search(
      corpus(
        ['z', 'c', 'a', 'b', 'd'].map((id) =>
          chunk(id, 'Guide', '# Guide\nsessions users'),
        ),
      ),
      'sessions users',
    );

    expect(result.kind).toBe('answer');
    if (result.kind === 'answer') {
      expect(result.chunks.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('ranks higher coverage before a lexically lower chunk ID', () => {
    const result = retriever.search(
      corpus([
        chunk('a-lower-id', 'Guide', '# Guide\nalpha documented'),
        chunk('z-higher-coverage', 'Guide', '# Guide\nalpha beta documented'),
      ]),
      'alpha beta',
    );

    expect(result.kind).toBe('answer');
    if (result.kind === 'answer') {
      expect(result.chunks.map(({ id }) => id)).toEqual([
        'z-higher-coverage',
        'a-lower-id',
      ]);
    }
  });

  it('ranks greater heading overlap before a lower ID at equal coverage', () => {
    const result = retriever.search(
      corpus([
        chunk('a-lower-id', 'Guide', '# Guide\nalpha beta documented'),
        chunk(
          'z-heading-overlap',
          'Alpha guide',
          '# Alpha guide\nalpha beta documented',
        ),
      ]),
      'alpha beta',
    );

    expect(result.kind).toBe('answer');
    if (result.kind === 'answer') {
      expect(result.chunks.map(({ id }) => id)).toEqual([
        'z-heading-overlap',
        'a-lower-id',
      ]);
    }
  });

  it('uses locale-independent code-point order for chunk ID ties', () => {
    const result = retriever.search(
      corpus(
        ['a', 'Z', '_'].map((id) =>
          chunk(id, 'Guide', '# Guide\nsessions users'),
        ),
      ),
      'sessions users',
    );

    expect(result.kind).toBe('answer');
    if (result.kind === 'answer') {
      expect(result.chunks.map(({ id }) => id)).toEqual(['Z', '_', 'a']);
    }
  });

  it('boosts an exact normalized heading before a higher-ID tie', () => {
    const result = retriever.search(
      corpus([
        chunk('a', 'Guide', '# Guide\nsessions users'),
        chunk('z', 'Sessions users', '# Sessions users\npublic details'),
      ]),
      'sessions users',
    );

    expect(result.kind).toBe('answer');
    if (result.kind === 'answer') {
      expect(result.chunks.map(({ id }) => id)).toEqual(['z', 'a']);
    }
  });

  it('refuses queries made only from stop words', () => {
    expect(
      retriever.search(
        corpus([chunk('a', 'Overview', '# Overview\nPublic facts')]),
        'the and or',
      ),
    ).toEqual({
      kind: 'refusal',
      normalizedQuery: '',
      reason: 'INSUFFICIENT_DOCUMENTATION',
    });
  });

  it('rejects a selected excerpt set above the internal 12,000-character cap', () => {
    expect(() =>
      retriever.search(
        corpus([
          chunk('a', 'Sessions', `# Sessions\nsessions ${'x'.repeat(12_000)}`),
        ]),
        'sessions',
      ),
    ).toThrow('ASSISTANT_CORPUS_UNAVAILABLE');
  });
});
