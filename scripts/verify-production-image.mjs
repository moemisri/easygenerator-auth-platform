import { spawnSync } from 'node:child_process';

import { hasExpectedProcessTree } from './production-image-process-tree.mjs';

const image = process.argv[2];
if (!image) throw new Error('IMAGE_REQUIRED');

function docker(arguments_) {
  return spawnSync('docker', arguments_, {
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
  });
}

function requireSuccess(result, category) {
  if (result.status !== 0) fail(category);
  return result.stdout;
}

function fail(category) {
  throw new Error(category);
}

try {
  const inspection = JSON.parse(
    requireSuccess(docker(['image', 'inspect', image]), 'INSPECT_FAILED'),
  )[0];
  if (
    !inspection ||
    inspection.Config.User === '' ||
    inspection.Config.User === '0' ||
    inspection.Config.User === 'root'
  ) {
    fail('ROOT_USER');
  }
  if (
    JSON.stringify(inspection.Config.Entrypoint) !==
    JSON.stringify(['/usr/bin/tini', '--'])
  ) {
    fail('INVALID_ENTRYPOINT');
  }
  if (
    JSON.stringify(inspection.Config.Cmd) !==
    JSON.stringify(['node', 'dist/main.js'])
  ) {
    fail('INVALID_COMMAND');
  }

  requireSuccess(
    docker([
      'run',
      '--rm',
      '-e',
      'VITEST=true',
      '-e',
      'NODE_ENV=development',
      '--entrypoint',
      'node',
      image,
      '--input-type=module',
      '--eval',
      "import fs from 'node:fs'; if(process.getuid()===0)process.exit(2); for(const p of ['dist/main.js','public/index.html','../../docs/assistant-public/overview.md'])fs.accessSync(p); await import('@easygenerator/contracts'); await import('argon2'); await import('./dist/main.js');",
    ]),
    'RUNTIME_ARTIFACT_FAILED',
  );

  const bootstrap = docker([
    'run',
    '--rm',
    '--network=none',
    '--read-only',
    '--tmpfs',
    '/tmp:uid=10001,gid=10001,mode=0700',
    '--entrypoint',
    'pnpm',
    image,
    '--filter',
    '@easygenerator/api',
    'bootstrap:admin',
  ]);
  const bootstrapOutput = `${bootstrap.stdout}${bootstrap.stderr}`;
  if (
    bootstrap.status !== 1 ||
    !bootstrapOutput.includes('Administrator bootstrap failed.')
  ) {
    fail('BOOTSTRAP_COMMAND_FAILED');
  }

  const containerName = `easygenerator-image-check-${process.pid}`;
  try {
    requireSuccess(
      docker([
        'run',
        '--detach',
        '--name',
        containerName,
        image,
        'node',
        '--eval',
        'setInterval(() => {}, 1000)',
      ]),
      'PROCESS_START_FAILED',
    );
    const processes = requireSuccess(
      docker(['top', containerName, '-eo', 'pid,ppid,comm,args']),
      'PROCESS_INSPECT_FAILED',
    );
    if (!hasExpectedProcessTree(processes)) {
      fail('PROCESS_TREE_INVALID');
    }
  } finally {
    docker(['rm', '--force', containerName]);
  }

  process.stdout.write('Production image verification passed.\n');
} catch (error) {
  process.stderr.write(
    `Production image verification failed: ${error.message}\n`,
  );
  process.exitCode = 1;
}
