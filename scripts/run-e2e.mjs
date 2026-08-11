import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const composeArguments = ['compose', '-f', 'compose.test.yaml'];
const testDatabaseName = 'easygenerator_auth_test';

const testEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  VITEST: 'false',
  PORT: '3000',
  MONGODB_URI:
    'mongodb://127.0.0.1:27018/easygenerator_auth_test?replicaSet=rs0&directConnection=true',
  DB_NAME: testDatabaseName,
  REDIS_URL: 'redis://127.0.0.1:6380',
  APP_ORIGIN: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  CSRF_SECRET: Buffer.alloc(32, 5).toString('base64'),
  IDENTITY_HASH_SECRET: Buffer.alloc(32, 6).toString('base64'),
  TRUST_PROXY_HOPS: '0',
  LOG_LEVEL: 'silent',
  ASSISTANT_ENABLED: 'false',
  SWAGGER_ENABLED: 'false',
};
delete testEnvironment.GEMINI_API_KEY;
delete testEnvironment.GEMINI_MODEL;
delete testEnvironment.RENDER_EXTERNAL_HOSTNAME;

const bootstrapEnvironment = {
  ...testEnvironment,
  ADMIN_EMAIL: 'task11-admin@example.test',
  ADMIN_NAME: 'Task 11 Administrator',
  ADMIN_PASSWORD: 'Task11Admin1!',
};

function exit(status) {
  return { kind: 'exit', status };
}

function signal(signalName) {
  return { kind: 'signal', signal: signalName };
}

function succeeded(termination) {
  return termination.kind === 'exit' && termination.status === 0;
}

export function normalizeForwardedArguments(arguments_) {
  const forwardedArguments = [...arguments_];
  if (forwardedArguments[0] === '--') forwardedArguments.shift();
  return forwardedArguments;
}

export function selectE2eTermination(
  setupTermination,
  playwrightStarted,
  playwrightTermination,
  cleanupTermination,
) {
  if (playwrightStarted) return playwrightTermination ?? exit(1);
  if (!succeeded(setupTermination)) return setupTermination;
  return cleanupTermination;
}

function terminateProcessGroup(child, signalName) {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    child.kill(signalName);
    return;
  }
  try {
    process.kill(-child.pid, signalName);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function commandRunner(onChild) {
  return ({ command, arguments: arguments_, environment = process.env }) =>
    new Promise((resolve) => {
      const child = spawn(command, arguments_, {
        cwd: repositoryRoot,
        detached: process.platform !== 'win32',
        env: environment,
        shell: false,
        stdio: 'inherit',
      });
      onChild(child);
      let settled = false;
      const finish = (termination) => {
        if (settled) return;
        settled = true;
        onChild(undefined);
        resolve(termination);
      };
      child.once('error', () => finish(exit(1)));
      child.once('exit', (status, signalName) => {
        if (status !== null) finish(exit(status));
        else if (signalName !== null) finish(signal(signalName));
        else finish(exit(1));
      });
    });
}

export async function runE2ePlan(plan) {
  let activeChild;
  let requestedSignal;
  const run = commandRunner((child) => {
    activeChild = child;
  });
  const handlers = new Map();

  for (const signalName of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      requestedSignal ??= signalName;
      if (activeChild !== undefined) {
        terminateProcessGroup(activeChild, signalName);
      }
    };
    handlers.set(signalName, handler);
    process.on(signalName, handler);
  }

  let setupTermination = exit(0);
  let playwrightStarted = false;
  let playwrightTermination;
  let cleanupTermination = exit(0);

  const runSetup = async (command) => {
    if (!succeeded(setupTermination) || requestedSignal !== undefined) return;
    setupTermination = await run(command);
    if (requestedSignal !== undefined) {
      setupTermination = signal(requestedSignal);
    }
  };

  try {
    for (const command of plan.setup) await runSetup(command);

    if (succeeded(setupTermination) && requestedSignal === undefined) {
      playwrightStarted = true;
      playwrightTermination = await run(plan.playwright);
      if (requestedSignal !== undefined) {
        playwrightTermination = signal(requestedSignal);
      }
    }
  } catch {
    if (!playwrightStarted) setupTermination = exit(1);
    else playwrightTermination = playwrightTermination ?? exit(1);
  } finally {
    cleanupTermination = await run(plan.cleanup);
    for (const [signalName, handler] of handlers) {
      process.off(signalName, handler);
    }
  }

  if (!succeeded(cleanupTermination)) {
    const detail =
      cleanupTermination.kind === 'signal'
        ? cleanupTermination.signal
        : `status ${cleanupTermination.status}`;
    process.stderr.write(`E2E environment cleanup failed with ${detail}.\n`);
  }

  return requestedSignal !== undefined
    ? signal(requestedSignal)
    : selectE2eTermination(
        setupTermination,
        playwrightStarted,
        playwrightTermination,
        cleanupTermination,
      );
}

export function applyE2eTermination(termination) {
  if (termination.kind === 'signal') {
    process.kill(process.pid, termination.signal);
    return;
  }
  process.exitCode = termination.status;
}

function command(commandName, arguments_, environment) {
  return {
    command: commandName,
    arguments: arguments_,
    ...(environment === undefined ? {} : { environment }),
  };
}

async function main(arguments_ = process.argv.slice(2)) {
  const forwardedArguments = normalizeForwardedArguments(arguments_);
  const termination = await runE2ePlan({
    setup: [
      command('docker', [...composeArguments, 'up', '--wait']),
      command('docker', [
        ...composeArguments,
        'run',
        '--rm',
        'mongo-init-test',
      ]),
      command('docker', [
        ...composeArguments,
        'exec',
        '-T',
        'mongo-test',
        'mongosh',
        'mongodb://localhost:27017/admin',
        '--quiet',
        '--eval',
        `db.getSiblingDB('${testDatabaseName}').dropDatabase()`,
      ]),
      command('docker', [
        ...composeArguments,
        'exec',
        '-T',
        'redis-test',
        'redis-cli',
        'FLUSHDB',
      ]),
      command(
        'pnpm',
        ['--filter', '@easygenerator/api', 'bootstrap:admin'],
        bootstrapEnvironment,
      ),
    ],
    playwright: command(
      'pnpm',
      ['exec', 'playwright', 'test', ...forwardedArguments],
      testEnvironment,
    ),
    cleanup: command('docker', [...composeArguments, 'down', '--volumes']),
  });
  applyE2eTermination(termination);
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) void main();
