import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { expect, it } from 'vitest';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

it('loads the import-safe administrator CLI through its real tsx runtime', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      "await import('./src/cli/bootstrap-admin.ts'); process.stdout.write('imported')",
    ],
    {
      cwd: path.join(repositoryRoot, 'apps', 'api'),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', APP_BOOTSTRAP: 'false' },
    },
  );

  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe('imported');
});

it('loads compiled API and CLI modules with emitted Nest constructor metadata', () => {
  const apiRoot = path.join(repositoryRoot, 'apps', 'api');
  const build = spawnSync(
    path.join(apiRoot, 'node_modules', '.bin', 'nest'),
    ['build'],
    {
      cwd: apiRoot,
      encoding: 'utf8',
      env: process.env,
    },
  );
  expect(build.status).toBe(0);
  expect(build.stderr).toBe('');

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
        await import('./dist/main.js');
        await import('./dist/cli/bootstrap-admin.js');
        const { AssistantCacheService } = await import(
          './dist/modules/assistant/assistant-cache.service.js'
        );
        const parameters = Reflect.getMetadata(
          'design:paramtypes',
          AssistantCacheService,
        );
        if (parameters?.[1]?.name !== 'ConfigService') {
          throw new Error('Compiled constructor metadata is missing');
        }
        process.stdout.write('compiled-runtime-loaded');
      `,
    ],
    {
      cwd: apiRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', APP_BOOTSTRAP: 'false' },
    },
  );

  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe('compiled-runtime-loaded');
}, 30_000);
