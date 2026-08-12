import { createHash } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { AppError } from '../../platform/errors/app-error.js';
import type { AssistantCorpus, CorpusChunk } from './assistant.types.js';

export const ASSISTANT_CORPUS_ROOT = Symbol('ASSISTANT_CORPUS_ROOT');
export const ASSISTANT_CORPUS_FILE_SYSTEM = Symbol(
  'ASSISTANT_CORPUS_FILE_SYSTEM',
);

export const ASSISTANT_CORPUS_FILES = [
  'api.md',
  'architecture.md',
  'authentication.md',
  'authorization.md',
  'deployment.md',
  'overview.md',
] as const;

const assistantCorpusFileNames = new Set<string>(ASSISTANT_CORPUS_FILES);
const atxHeading = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export interface AssistantCorpusFileSystem {
  lstat(candidate: string): Promise<Stats>;
  readFile(candidate: string): Promise<Buffer>;
  readdir(candidate: string): Promise<Dirent[]>;
  realpath(candidate: string): Promise<string>;
}

export const assistantCorpusFileSystem: AssistantCorpusFileSystem = {
  lstat,
  readFile: (candidate) => readFile(candidate),
  readdir: (candidate) => readdir(candidate, { withFileTypes: true }),
  realpath,
};

function corpusUnavailable(): AppError {
  return new AppError('ASSISTANT_CORPUS_UNAVAILABLE', 503);
}

function normalizeLineEndings(bytes: Buffer): string {
  return bytes.toString('utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function chunkId(file: string, heading: string, ordinal: number): string {
  return createHash('sha256')
    .update(file)
    .update('\0')
    .update(heading)
    .update('\0')
    .update(String(ordinal))
    .digest('base64url');
}

function createChunk(
  file: string,
  heading: string,
  ordinal: number,
  content: string,
): CorpusChunk {
  return {
    id: chunkId(file, heading, ordinal),
    file,
    heading,
    content,
  };
}

function splitDocument(file: string, content: string): CorpusChunk[] {
  const lines = content.split('\n');
  const headings: Array<{ index: number; heading: string }> = [];
  for (const [index, line] of lines.entries()) {
    const match = atxHeading.exec(line);
    const heading = match?.[2];
    if (heading !== undefined)
      headings.push({ index, heading: heading.trim() });
  }

  const chunks: CorpusChunk[] = [];
  const firstHeadingIndex = headings[0]?.index ?? lines.length;
  const preamble = lines.slice(0, firstHeadingIndex).join('\n');
  let ordinal = 0;
  if (preamble.trim().length > 0) {
    chunks.push(createChunk(file, 'Document', ordinal, preamble));
    ordinal += 1;
  }

  for (const [headingIndex, heading] of headings.entries()) {
    const nextIndex = headings[headingIndex + 1]?.index ?? lines.length;
    const hasFollowingHeading = headings[headingIndex + 1] !== undefined;
    const chunkContent = lines.slice(heading.index, nextIndex).join('\n');
    chunks.push(
      createChunk(
        file,
        heading.heading,
        ordinal,
        hasFollowingHeading ? `${chunkContent}\n` : chunkContent,
      ),
    );
    ordinal += 1;
  }
  return chunks;
}

@Injectable()
export class DocumentLoaderService {
  constructor(
    @Inject(ASSISTANT_CORPUS_ROOT) private readonly root: string,
    @Inject(ASSISTANT_CORPUS_FILE_SYSTEM)
    private readonly fileSystem: AssistantCorpusFileSystem,
  ) {}

  async load(): Promise<AssistantCorpus> {
    try {
      const rootStat = await this.fileSystem.lstat(this.root);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw corpusUnavailable();
      }
      const resolvedRoot = await this.fileSystem.realpath(this.root);
      const entries = await this.fileSystem.readdir(resolvedRoot);

      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.isDirectory()) {
          throw corpusUnavailable();
        }
        if (
          entry.isFile() &&
          entry.name.endsWith('.md') &&
          !assistantCorpusFileNames.has(entry.name)
        ) {
          throw corpusUnavailable();
        }
      }

      const digest = createHash('sha256');
      const chunks: CorpusChunk[] = [];
      const containmentPrefix = `${resolvedRoot}${path.sep}`;
      for (const file of ASSISTANT_CORPUS_FILES) {
        const candidate = path.join(resolvedRoot, file);
        const fileStat = await this.fileSystem.lstat(candidate);
        if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
          throw corpusUnavailable();
        }
        const resolvedCandidate = await this.fileSystem.realpath(candidate);
        if (!resolvedCandidate.startsWith(containmentPrefix)) {
          throw corpusUnavailable();
        }
        const normalizedContent = normalizeLineEndings(
          await this.fileSystem.readFile(resolvedCandidate),
        );
        digest.update(file).update('\0').update(normalizedContent);
        const documentChunks = splitDocument(file, normalizedContent);
        if (documentChunks.length === 0) throw corpusUnavailable();
        chunks.push(...documentChunks);
      }

      return { digest: digest.digest('base64url'), chunks };
    } catch {
      throw corpusUnavailable();
    }
  }
}
