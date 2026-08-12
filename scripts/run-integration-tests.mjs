import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const composeArguments = ['compose', '-f', 'compose.test.yaml'];

const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  VITEST: 'true',
  APP_BOOTSTRAP: 'false',
  MONGODB_URI:
    'mongodb://127.0.0.1:27018/easygenerator_auth_test?replicaSet=rs0&directConnection=true',
  DB_NAME: 'easygenerator_auth_test',
  REDIS_URL: 'redis://127.0.0.1:6380',
  APP_ORIGIN: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  CSRF_SECRET: Buffer.alloc(32, 3).toString('base64'),
  IDENTITY_HASH_SECRET: Buffer.alloc(32, 4).toString('base64'),
  TRUST_PROXY_HOPS: '0',
  LOG_LEVEL: 'silent',
  ASSISTANT_ENABLED: 'false',
};

function run(command, arguments_, environment = process.env) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: environment,
    shell: false,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

export function selectIntegrationExitStatus(
  setupStatus,
  vitestStarted,
  vitestStatus,
  cleanupStatus,
) {
  if (vitestStarted) return vitestStatus;
  if (setupStatus !== 0) return setupStatus;
  return cleanupStatus;
}

function main(arguments_ = process.argv.slice(2)) {
  const forwardedArguments = [...arguments_];
  if (forwardedArguments[0] === '--') forwardedArguments.shift();

  let setupStatus = 0;
  let vitestStarted = false;
  let vitestStatus = 1;
  let cleanupStatus = 0;

  try {
    setupStatus = run('docker', [...composeArguments, 'up', '--wait']);
    if (setupStatus === 0) {
      setupStatus = run('docker', [
        ...composeArguments,
        'run',
        '--rm',
        'mongo-init-test',
      ]);
    }

    if (setupStatus === 0) {
      vitestStarted = true;
      vitestStatus = run(
        'pnpm',
        [
          '--filter',
          '@easygenerator/api',
          'test:integration:run',
          '--',
          ...forwardedArguments,
        ],
        testEnvironment,
      );
    }
  } finally {
    cleanupStatus = run('docker', [...composeArguments, 'down', '--volumes']);
  }

  if (cleanupStatus !== 0) {
    process.stderr.write(
      `Integration test environment cleanup failed with status ${cleanupStatus}.\n`,
    );
  }

  return selectIntegrationExitStatus(
    setupStatus,
    vitestStarted,
    vitestStatus,
    cleanupStatus,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exitCode = main();
}
