import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const forwardedArguments = process.argv.slice(2);
if (forwardedArguments[0] === '--') forwardedArguments.shift();

const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', ...forwardedArguments],
  {
    cwd: path.join(repositoryRoot, 'apps', 'api'),
    env: process.env,
    shell: false,
    stdio: 'inherit',
  },
);

process.exitCode = result.status ?? 1;
