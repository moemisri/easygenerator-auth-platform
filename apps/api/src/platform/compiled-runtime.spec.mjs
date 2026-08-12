import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

function run(command, arguments_, environment = process.env) {
  return spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    shell: false,
  });
}

describe('compiled API runtime', () => {
  beforeAll(() => {
    const contractsBuild = run('pnpm', [
      '--filter',
      '@easygenerator/contracts',
      'build',
    ]);
    if (contractsBuild.status !== 0) {
      throw new Error(contractsBuild.stderr || contractsBuild.stdout);
    }

    const build = run('pnpm', ['--filter', '@easygenerator/api', 'build']);

    if (build.status !== 0) throw new Error(build.stderr || build.stdout);
  }, 30_000);

  it.each(['apps/api/dist/main.js', 'apps/api/dist/cli/bootstrap-admin.js'])(
    'is importable by plain Node without experimental resolution flags: %s',
    (entrypoint) => {
      const imported = run(
        process.execPath,
        ['--input-type=module', '--eval', `await import('./${entrypoint}')`],
        { ...process.env, APP_BOOTSTRAP: 'false' },
      );

      expect(imported.status).toBe(0);
      expect(imported.stderr || imported.stdout).toBe('');
    },
  );

  it('runs the operational admin bootstrap from compiled code with production dependencies only', () => {
    const packageManifest = JSON.parse(
      fs.readFileSync(
        path.join(repositoryRoot, 'apps/api/package.json'),
        'utf8',
      ),
    );

    expect(packageManifest.scripts['bootstrap:admin']).toBe(
      'node dist/cli/bootstrap-admin.js',
    );
  });
});
