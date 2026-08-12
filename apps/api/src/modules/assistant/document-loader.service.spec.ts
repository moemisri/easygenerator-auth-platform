import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assistantCorpusFileSystem,
  ASSISTANT_CORPUS_FILES,
  DocumentLoaderService,
} from './document-loader.service';

const fixtureContent: Record<(typeof ASSISTANT_CORPUS_FILES)[number], string> =
  {
    'api.md': '# API\r\n\r\nPOST requests use JSON.\r\n',
    'architecture.md': '# Architecture\n\nThe API is a Nest application.\n',
    'authentication.md':
      'Public preamble.\n\n# Sessions\n\nSessions are server-side.\n## Cookies ##\n\nCookies are HttpOnly.\n',
    'authorization.md': '# Authorization\n\nRoles grant capabilities.\n',
    'deployment.md': '# Deployment\n\nThe service has health routes.\n',
    'overview.md': '# Overview\n\nThe platform manages accounts.\n',
  };

describe('DocumentLoaderService', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'assistant-corpus-'));
    await Promise.all(
      ASSISTANT_CORPUS_FILES.map((file) =>
        writeFile(path.join(root, file), fixtureContent[file], 'utf8'),
      ),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('loads the exact direct allowlist in stable filename and chunk order', async () => {
    await writeFile(path.join(root, 'README.txt'), 'ignored', 'utf8');

    const corpus = await new DocumentLoaderService(
      root,
      assistantCorpusFileSystem,
    ).load();

    expect([...new Set(corpus.chunks.map((chunk) => chunk.file))]).toEqual([
      'api.md',
      'architecture.md',
      'authentication.md',
      'authorization.md',
      'deployment.md',
      'overview.md',
    ]);
    expect(
      corpus.chunks
        .filter((chunk) => chunk.file === 'authentication.md')
        .map(({ heading, content }) => ({ heading, content })),
    ).toEqual([
      { heading: 'Document', content: 'Public preamble.\n' },
      {
        heading: 'Sessions',
        content: '# Sessions\n\nSessions are server-side.\n',
      },
      {
        heading: 'Cookies',
        content: '## Cookies ##\n\nCookies are HttpOnly.\n',
      },
    ]);
  });

  it('assigns immutable IDs from filename, heading, and file-local ordinal', async () => {
    const corpus = await new DocumentLoaderService(
      root,
      assistantCorpusFileSystem,
    ).load();
    const sessions = corpus.chunks.find(
      (chunk) =>
        chunk.file === 'authentication.md' && chunk.heading === 'Sessions',
    );
    const expectedId = createHash('sha256')
      .update('authentication.md')
      .update('\0')
      .update('Sessions')
      .update('\0')
      .update('1')
      .digest('base64url');

    expect(sessions?.id).toBe(expectedId);
  });

  it('normalizes line endings for the digest and changes it after content changes', async () => {
    const original = await new DocumentLoaderService(
      root,
      assistantCorpusFileSystem,
    ).load();

    await writeFile(
      path.join(root, 'api.md'),
      fixtureContent['api.md'].replaceAll('\r\n', '\n'),
      'utf8',
    );
    const sameNormalizedContent = await new DocumentLoaderService(
      root,
      assistantCorpusFileSystem,
    ).load();
    expect(sameNormalizedContent.digest).toBe(original.digest);

    await writeFile(
      path.join(root, 'api.md'),
      `${fixtureContent['api.md']}A new public fact.\n`,
      'utf8',
    );
    const changed = await new DocumentLoaderService(
      root,
      assistantCorpusFileSystem,
    ).load();
    expect(changed.digest).not.toBe(original.digest);
  });

  it('shares one immutable corpus load across concurrent and later requests', async () => {
    const readCorpusFile = vi.fn((candidate: string) =>
      assistantCorpusFileSystem.readFile(candidate),
    );
    const loader = new DocumentLoaderService(root, {
      ...assistantCorpusFileSystem,
      readFile: readCorpusFile,
    });

    const [first, concurrent] = await Promise.all([
      loader.load(),
      loader.load(),
    ]);
    const later = await loader.load();

    expect(concurrent).toBe(first);
    expect(later).toBe(first);
    expect(readCorpusFile).toHaveBeenCalledTimes(ASSISTANT_CORPUS_FILES.length);
  });

  it('retries a failed load instead of memoizing the rejection', async () => {
    let shouldFail = true;
    const loader = new DocumentLoaderService(root, {
      ...assistantCorpusFileSystem,
      readFile: async (candidate) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('transient private filesystem detail');
        }
        return assistantCorpusFileSystem.readFile(candidate);
      },
    });

    await expect(loader.load()).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
    const recovered = await loader.load();
    expect(typeof recovered.digest).toBe('string');
    expect(Array.isArray(recovered.chunks)).toBe(true);
  });

  it('rejects a missing allowlisted file', async () => {
    await rm(path.join(root, 'overview.md'));

    await expect(
      new DocumentLoaderService(root, assistantCorpusFileSystem).load(),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
  });

  it('rejects an allowlisted file that contains no document chunk', async () => {
    await writeFile(path.join(root, 'overview.md'), '  \n\n', 'utf8');

    await expect(
      new DocumentLoaderService(root, assistantCorpusFileSystem).load(),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
  });

  it('rejects an unexpected direct Markdown file', async () => {
    await writeFile(path.join(root, 'private.md'), '# Private', 'utf8');

    await expect(
      new DocumentLoaderService(root, assistantCorpusFileSystem).load(),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
  });

  it('rejects a root symlink', async () => {
    const linkedRoot = `${root}-link`;
    await symlink(root, linkedRoot, 'dir');
    try {
      await expect(
        new DocumentLoaderService(linkedRoot, assistantCorpusFileSystem).load(),
      ).rejects.toMatchObject({
        code: 'ASSISTANT_CORPUS_UNAVAILABLE',
        status: 503,
      });
    } finally {
      await rm(linkedRoot, { force: true });
    }
  });

  it('rejects a file symlink even when its target is inside the root', async () => {
    await rm(path.join(root, 'overview.md'));
    await symlink('api.md', path.join(root, 'overview.md'));

    await expect(
      new DocumentLoaderService(root, assistantCorpusFileSystem).load(),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
  });

  it('rejects a nested directory without traversing it', async () => {
    const nested = path.join(root, 'nested');
    await mkdir(nested);
    await writeFile(path.join(nested, 'extra.md'), '# Extra', 'utf8');

    await expect(
      new DocumentLoaderService(root, assistantCorpusFileSystem).load(),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
  });

  it('rejects a candidate whose resolved path falls outside root containment', async () => {
    const realRoot = await realpath(root);
    const outside = path.join(path.dirname(realRoot), 'outside.md');
    const fileSystem = {
      ...assistantCorpusFileSystem,
      realpath: async (candidate: string) =>
        candidate === path.join(realRoot, 'overview.md')
          ? outside
          : realpath(candidate),
    };

    await expect(
      new DocumentLoaderService(root, fileSystem).load(),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CORPUS_UNAVAILABLE',
      status: 503,
    });
  });

  it('never includes secret-like content from a non-allowlisted file', async () => {
    await writeFile(
      path.join(root, '.env'),
      'GEMINI_API_KEY=must-not-load',
      'utf8',
    );

    const corpus = await new DocumentLoaderService(
      root,
      assistantCorpusFileSystem,
    ).load();
    const bytes = await readFile(path.join(root, '.env'), 'utf8');

    expect(bytes).toContain('GEMINI_API_KEY');
    expect(corpus.chunks.some((chunk) => chunk.content.includes(bytes))).toBe(
      false,
    );
  });
});
