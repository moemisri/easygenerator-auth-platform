import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const composeArguments = ['compose', '-f', 'compose.test.yaml'];
const forwardedArguments = process.argv.slice(2);
if (forwardedArguments[0] === '--') forwardedArguments.shift();

const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  VITEST: 'true',
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

let primaryStatus = 1;
let vitestStarted = false;
let cleanupStatus = 0;

try {
  primaryStatus = run('docker', [...composeArguments, 'up', '--wait']);
  if (primaryStatus === 0) {
    primaryStatus = run('docker', [
      ...composeArguments,
      'run',
      '--rm',
      'mongo-init-test',
    ]);
    if (primaryStatus === 0) {
      vitestStarted = true;
      primaryStatus = run(
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
  }
} finally {
  cleanupStatus = run('docker', [...composeArguments, 'down', '--volumes']);
}

process.exitCode =
  primaryStatus !== 0 || vitestStarted ? primaryStatus : cleanupStatus;
if (primaryStatus === 0 && cleanupStatus !== 0) {
  process.exitCode = cleanupStatus;
}
