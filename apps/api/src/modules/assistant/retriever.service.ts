import { Injectable } from '@nestjs/common';

import type {
  AssistantCorpus,
  CorpusChunk,
  RetrievalResult,
  RetrievedChunk,
} from './assistant.types.js';
import { fitExcerptChunks } from './assistant.types.js';

export const ASSISTANT_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'who',
  'why',
  'with',
  'your',
]);

const termPattern = /[\p{L}\p{N}]+/gu;
export function normalizeMeaningfulTerms(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const match of normalized.matchAll(termPattern)) {
    const term = match[0];
    if (ASSISTANT_STOP_WORDS.has(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

interface RankedChunk extends RetrievedChunk {
  exactHeading: boolean;
  headingOverlap: number;
}

function rankChunk(chunk: CorpusChunk, queryTerms: string[]): RankedChunk {
  const contentTerms = new Set(normalizeMeaningfulTerms(chunk.content));
  const headingTerms = normalizeMeaningfulTerms(chunk.heading);
  const headingTermSet = new Set(headingTerms);
  const matches = queryTerms.filter((term) => contentTerms.has(term)).length;
  return {
    ...chunk,
    coverage: matches / queryTerms.length,
    exactHeading: headingTerms.join(' ') === queryTerms.join(' '),
    headingOverlap: queryTerms.filter((term) => headingTermSet.has(term))
      .length,
  };
}

function publicChunk(chunk: RankedChunk): RetrievedChunk {
  return {
    id: chunk.id,
    file: chunk.file,
    heading: chunk.heading,
    content: chunk.content,
    coverage: chunk.coverage,
  };
}

@Injectable()
export class RetrieverService {
  search(corpus: AssistantCorpus, query: string): RetrievalResult {
    const queryTerms = normalizeMeaningfulTerms(query);
    const normalizedQuery = queryTerms.join(' ');
    if (queryTerms.length === 0) {
      return {
        kind: 'refusal',
        normalizedQuery,
        reason: 'INSUFFICIENT_DOCUMENTATION',
      };
    }

    const ranked = corpus.chunks
      .map((chunk) => rankChunk(chunk, queryTerms))
      .filter((chunk) => chunk.coverage > 0)
      .sort(
        (left, right) =>
          Number(right.exactHeading) - Number(left.exactHeading) ||
          right.coverage - left.coverage ||
          right.headingOverlap - left.headingOverlap ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      );

    const oneTermIsEligible =
      queryTerms.length !== 1 ||
      ranked.some((chunk) => chunk.headingOverlap > 0);
    const best = ranked[0];
    if (
      !oneTermIsEligible ||
      best === undefined ||
      (!best.exactHeading && best.coverage < 0.4)
    ) {
      return {
        kind: 'refusal',
        normalizedQuery,
        reason: 'INSUFFICIENT_DOCUMENTATION',
      };
    }

    const selected = fitExcerptChunks(ranked);

    return {
      kind: 'answer',
      normalizedQuery,
      chunks: selected.map(publicChunk),
    };
  }
}
