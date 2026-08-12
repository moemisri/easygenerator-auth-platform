import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export function interpretTestProcessResult({ status, signal }) {
  if (status !== null) return { kind: 'exit', status };
  if (signal !== null) return { kind: 'signal', signal };
  return { kind: 'exit', status: 1 };
}

function main(arguments_ = process.argv.slice(2)) {
  const forwardedArguments = [...arguments_];
  if (forwardedArguments[0] === '--') forwardedArguments.shift();

  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', ...forwardedArguments],
    {
      cwd: path.join(repositoryRoot, 'apps', 'api'),
      env: { ...process.env, APP_BOOTSTRAP: 'false' },
      shell: false,
      stdio: 'inherit',
    },
  );
  const termination = interpretTestProcessResult(result);

  if (termination.kind === 'signal') {
    process.kill(process.pid, termination.signal);
    return;
  }

  process.exitCode = termination.status;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) main();
