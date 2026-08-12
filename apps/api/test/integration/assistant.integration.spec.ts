import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  authSessionResponseSchema,
  problemDetailsSchema,
  type ProblemDetails,
} from '@easygenerator/contracts';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import { Logger } from 'nestjs-pino';
import request, { type Response } from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/main';
import { AssistantConcurrencyService } from '../../src/modules/assistant/assistant-concurrency.service';
import { AssistantRateLimiterService } from '../../src/modules/assistant/assistant-rate-limiter.service';
import { ASSISTANT_DEADLINE_MILLISECONDS } from '../../src/modules/assistant/assistant.service';
import {
  ASSISTANT_PROVIDER,
  type AssistantProvider,
  type AssistantProviderInput,
} from '../../src/modules/assistant/assistant.types';
import { GOOGLE_GENAI_FACTORY } from '../../src/modules/assistant/gemini.provider';
import type { AppConfig } from '../../src/platform/config/config.schema';
import { configuration } from '../../src/platform/config/configuration';
import { DatabaseIndexInitializer } from '../../src/platform/database/database-index-initializer';
import { ProblemDetailsFilter } from '../../src/platform/errors/problem-details.filter';
import { REDIS } from '../../src/platform/redis/redis.constants';
import { resetDatastores } from '../support/reset-datastores';

const appOrigin = 'http://localhost:5173';
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const composeFile = path.join(repositoryRoot, 'compose.test.yaml');
const validSignup = {
  email: 'assistant-user@example.com',
  name: 'Assistant User',
  password: 'Secure1!',
};

interface ProviderCall {
  input: AssistantProviderInput;
  signal: AbortSignal;
}

function asyncIterableOf(...values: string[]): AsyncIterable<string> {
  let index = 0;
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const value = values[index];
        index += 1;
        return Promise.resolve(
          value === undefined
            ? { done: true as const, value: undefined }
            : { done: false as const, value },
        );
      },
    }),
  };
}

class FakeAssistantProvider implements AssistantProvider {
  calls: ProviderCall[] = [];
  abortObserved = false;
  private startedResolve!: () => void;
  private holdResolve!: () => void;
  private stallResolve!: () => void;
  private stalledFinalizedResolve!: () => void;
  started = Promise.resolve();
  private hold = Promise.resolve();
  private stall = Promise.resolve();
  stalledFinalized = Promise.resolve();

  reset(): void {
    this.calls = [];
    this.abortObserved = false;
    this.started = new Promise<void>((resolve) => {
      this.startedResolve = resolve;
    });
    this.hold = new Promise<void>((resolve) => {
      this.holdResolve = resolve;
    });
    this.stall = new Promise<void>((resolve) => {
      this.stallResolve = resolve;
    });
    this.stalledFinalized = new Promise<void>((resolve) => {
      this.stalledFinalizedResolve = resolve;
    });
  }

  releaseHeldStream(): void {
    this.holdResolve();
  }

  releaseStalledStream(): void {
    this.stallResolve();
  }

  stream(
    input: AssistantProviderInput,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    this.calls.push({ input, signal });
    this.startedResolve();
    const currentMessage =
      /Current user message:\n([^\n]+)\n\nPublic documentation excerpts:/.exec(
        input.contents,
      )?.[1] ?? '';
    if (currentMessage.includes('deadline')) {
      const completion = new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            this.abortObserved = true;
            resolve();
          },
          { once: true },
        );
      });
      const iterator: AsyncIterator<string> = {
        next: async () => {
          await completion;
          return { done: true, value: undefined };
        },
        return: async () => {
          await completion;
          return { done: true, value: undefined };
        },
      };
      return { [Symbol.asyncIterator]: () => iterator };
    }
    if (currentMessage.includes('disconnect')) {
      const observeAbort = () => {
        this.abortObserved = true;
      };
      return (async function* () {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              observeAbort();
              resolve();
            },
            { once: true },
          );
        });
        yield 'must not reach the disconnected client';
      })();
    }
    if (currentMessage.includes('stalled')) {
      const stall = this.stall;
      const markFinalized = this.stalledFinalizedResolve;
      return (async function* () {
        try {
          await stall;
          yield 'must not reach the timed-out client';
        } finally {
          markFinalized();
        }
      })();
    }
    if (currentMessage.includes('contention')) {
      const hold = this.hold;
      return (async function* () {
        await hold;
        yield 'The held stream completed.';
      })();
    }
    if (currentMessage.includes('failure')) {
      const iterator: AsyncIterator<string> = {
        next: () => Promise.reject(new Error('private fake provider body')),
        return: () => Promise.resolve({ done: true, value: undefined }),
      };
      return { [Symbol.asyncIterator]: () => iterator };
    }
    return asyncIterableOf('Sessions are ', 'stored server-side.');
  }
}

function parseSse(text: string): Array<{ type: string; data: unknown }> {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const match = /^event: ([^\n]+)\ndata: ([^\n]+)$/.exec(frame);
      if (match === null) throw new Error(`Invalid SSE frame: ${frame}`);
      const data: unknown = JSON.parse(match[2]!);
      return { type: match[1]!, data };
    });
}

function problem(response: Response): ProblemDetails {
  return problemDetailsSchema.parse(response.body);
}

function dockerCompose(...arguments_: string[]): void {
  execFileSync('docker', ['compose', '-f', composeFile, ...arguments_], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
}

async function waitForRedis(redis: Redis): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await redis.ping();
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error('Redis did not recover after restart');
}

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      5,
    );
    cursor = nextCursor;
    found.push(...keys);
  } while (cursor !== '0');
  return found.sort();
}

function privacyDigest(scope: string, value: string): string {
  return createHmac('sha256', Buffer.alloc(32, 4))
    .update(scope)
    .update('\0')
    .update(value)
    .digest('base64url');
}

function assistantLeaseKey(userId: string): string {
  return `easygenerator:test:assistant:active:${privacyDigest(
    'assistant:lease:actor',
    userId,
  )}`;
}

async function createAssistantApp(
  enabled: boolean,
  provider: AssistantProvider,
  googleFactory: ReturnType<typeof vi.fn>,
): Promise<NestExpressApplication> {
  const appConfig = configuration({
    ...process.env,
    ASSISTANT_ENABLED: String(enabled),
    ...(enabled
      ? { GEMINI_API_KEY: 'integration-test-only', GEMINI_MODEL: 'fake-model' }
      : { GEMINI_API_KEY: undefined, GEMINI_MODEL: undefined }),
  });
  const testConfig = new ConfigService<AppConfig, true>(appConfig);
  const testingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ConfigService)
    .useValue(testConfig)
    .overrideProvider(ASSISTANT_PROVIDER)
    .useValue(provider)
    .overrideProvider(GOOGLE_GENAI_FACTORY)
    .useValue(googleFactory)
    .overrideProvider(ASSISTANT_DEADLINE_MILLISECONDS)
    .useValue(200)
    .compile();
  const app = testingModule.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    bufferLogs: true,
  });
  const config = app.get(ConfigService<AppConfig, true>);
  app.useLogger(app.get(Logger));
  configureApplication(
    app,
    {
      TRUST_PROXY_HOPS: config.get('TRUST_PROXY_HOPS', { infer: true }),
    },
    app.get(ProblemDetailsFilter),
  );
  await app.init();
  const connection = app.get<Connection>(getConnectionToken());
  if (connection.name !== 'easygenerator_auth_test') {
    await app.close();
    throw new Error(`Refusing to test against database ${connection.name}`);
  }
  await app.get(DatabaseIndexInitializer).ensureSecurityCriticalIndexes();
  return app;
}

interface SignedInUser {
  agent: ReturnType<typeof request.agent>;
  csrfToken: string;
  userId: string;
}

async function signUp(app: NestExpressApplication): Promise<SignedInUser> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent
    .post('/api/v1/auth/signup')
    .set('Origin', appOrigin)
    .send(validSignup)
    .expect(201);
  const body = authSessionResponseSchema.parse(response.body);
  return {
    agent,
    csrfToken: body.csrfToken,
    userId: body.user.id,
  };
}

function chat(
  signedIn: SignedInUser,
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
) {
  return signedIn.agent
    .post('/api/v1/assistant/chat')
    .set('Origin', appOrigin)
    .set('X-CSRF-Token', signedIn.csrfToken)
    .send({ message, history });
}

describe('assistant HTTP API', () => {
  const provider = new FakeAssistantProvider();
  const disabledStream = vi.fn((): AsyncIterable<string> => asyncIterableOf());
  const disabledProvider: AssistantProvider = { stream: disabledStream };
  const googleFactory = vi.fn();
  let app: NestExpressApplication;
  let disabledApp: NestExpressApplication;

  beforeAll(async () => {
    disabledApp = await createAssistantApp(
      false,
      disabledProvider,
      googleFactory,
    );
    app = await createAssistantApp(true, provider, googleFactory);
  });

  beforeEach(async () => {
    await resetDatastores(app);
    provider.reset();
    disabledStream.mockClear();
    googleFactory.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    await disabledApp?.close();
  });

  it('runs origin, session, and CSRF guards before chat validation or streaming', async () => {
    const missingOrigin = await request(app.getHttpServer())
      .post('/api/v1/assistant/chat')
      .send({ message: 'sessions' })
      .expect(403);
    expect(problem(missingOrigin).code).toBe('HTTP_403');

    const missingSession = await request(app.getHttpServer())
      .post('/api/v1/assistant/chat')
      .set('Origin', appOrigin)
      .send({ message: 'sessions' })
      .expect(401);
    expect(problem(missingSession).code).toBe('UNAUTHENTICATED');

    const signedIn = await signUp(app);
    const missingCsrf = await signedIn.agent
      .post('/api/v1/assistant/chat')
      .set('Origin', appOrigin)
      .send({ message: 'sessions' })
      .expect(403);
    expect(problem(missingCsrf).code).toBe('CSRF_VALIDATION_FAILED');
    expect(provider.calls).toHaveLength(0);
  });

  it('returns disabled after valid guards without constructing or calling the SDK', async () => {
    const signedIn = await signUp(disabledApp);
    const response = await chat(signedIn, 'sessions').expect(404);

    expect(problem(response)).toMatchObject({
      code: 'ASSISTANT_DISABLED',
      status: 404,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(disabledStream).not.toHaveBeenCalled();
    expect(googleFactory).not.toHaveBeenCalled();
  });

  it('rejects an invalid strict body before provider access', async () => {
    const signedIn = await signUp(app);
    const response = await signedIn.agent
      .post('/api/v1/assistant/chat')
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', signedIn.csrfToken)
      .send({ message: 'sessions', history: [], tools: [] })
      .expect(400);

    expect(problem(response).code).toBe('VALIDATION_ERROR');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(provider.calls).toHaveLength(0);
  });

  it('streams source-first JSON SSE and caches only current chunk IDs', async () => {
    const signedIn = await signUp(app);
    const response = await chat(signedIn, 'sessions', [
      { role: 'user', content: 'Tell me about authentication.' },
    ]).expect(200);

    expect(response.headers['content-type']).toContain(
      'text/event-stream; charset=utf-8',
    );
    expect(response.headers['cache-control']).toBe('no-store, no-transform');
    expect(response.headers['connection']).toBe('keep-alive');
    expect(response.headers['x-accel-buffering']).toBe('no');
    const streamed = parseSse(response.text);
    expect(streamed[0]).toMatchObject({ type: 'sources' });
    expect(streamed.at(-1)).toEqual({
      type: 'done',
      data: { outcome: 'answered' },
    });
    expect(streamed.filter((event) => event.type === 'done')).toHaveLength(1);

    const redis = app.get<Redis>(REDIS);
    const keys = await scanKeys(
      redis,
      'easygenerator:test:assistant:retrieval:*',
    );
    expect(keys).toHaveLength(1);
    const value = await redis.get(keys[0]!);
    if (value === null) throw new Error('Expected a cached retrieval value');
    const cachedIds: unknown = JSON.parse(value);
    if (!Array.isArray(cachedIds)) throw new Error('Expected cached chunk IDs');
    expect(cachedIds).not.toHaveLength(0);
    expect(cachedIds.every((id) => typeof id === 'string')).toBe(true);
    expect(value).not.toContain('sessions');
    expect(keys[0]).not.toContain('sessions');
  });

  it('locally refuses weak evidence and persists only safe audit metadata', async () => {
    const signedIn = await signUp(app);
    const sentinel = 'personal-weather-sentinel';
    const response = await chat(signedIn, `weather cairo ${sentinel}`).expect(
      200,
    );

    expect(parseSse(response.text)).toEqual([
      { type: 'sources', data: { sources: [] } },
      { type: 'done', data: { outcome: 'refused' } },
    ]);
    expect(provider.calls).toHaveLength(0);
    const connection = app.get<Connection>(getConnectionToken());
    const event = await connection
      .collection('auditevents')
      .findOne({ action: 'ASSISTANT_REFUSED' });
    expect(event).toMatchObject({
      actorId: signedIn.userId,
      metadata: { reason: 'INSUFFICIENT_DOCUMENTATION' },
    });
    expect(JSON.stringify(event)).not.toContain(sentinel);
  });

  it('atomically charges real Redis budgets while isolating an exhausted user', async () => {
    const limiter = app.get(AssistantRateLimiterService);
    const redis = app.get<Redis>(REDIS);
    const admittedUser = 'assistant-rate-admitted-user';
    const unrelatedUser = 'assistant-rate-unrelated-user';
    const requestIp = '192.0.2.44';
    const admittedUserKey = `easygenerator:test:assistant:rate:user:${privacyDigest(
      'assistant:rate:user',
      admittedUser,
    )}`;
    const unrelatedUserKey = `easygenerator:test:assistant:rate:user:${privacyDigest(
      'assistant:rate:user',
      unrelatedUser,
    )}`;
    const ipKey = `easygenerator:test:assistant:rate:ip:${privacyDigest(
      'assistant:rate:ip',
      requestIp,
    )}`;
    const globalKey = 'easygenerator:test:assistant:rate:global';

    await expect(
      limiter.enforce(admittedUser, requestIp),
    ).resolves.toBeUndefined();
    await expect(
      redis.mget(admittedUserKey, ipKey, globalKey),
    ).resolves.toEqual(['1', '1', '1']);

    await redis.set(admittedUserKey, '10', 'EX', 60);
    await expect(
      limiter.enforce(admittedUser, requestIp),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    await expect(redis.mget(ipKey, globalKey)).resolves.toEqual(['1', '1']);

    await expect(
      limiter.enforce(unrelatedUser, requestIp),
    ).resolves.toBeUndefined();
    await expect(
      redis.mget(unrelatedUserKey, ipKey, globalKey),
    ).resolves.toEqual(['1', '2', '2']);
  });

  it('allows ten requests and rate-limits eleven with Retry-After', async () => {
    const signedIn = await signUp(app);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await chat(signedIn, 'sessions').expect(200);
    }
    const denied = await chat(signedIn, 'sessions').expect(429);

    expect(problem(denied).code).toBe('RATE_LIMITED');
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(denied.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(provider.calls).toHaveLength(10);
    const keys = await scanKeys(
      app.get<Redis>(REDIS),
      'easygenerator:test:assistant:rate:*',
    );
    expect(keys).toHaveLength(3);
    expect(keys).toContain('easygenerator:test:assistant:rate:global');
    expect(keys).toContain(
      `easygenerator:test:assistant:rate:user:${privacyDigest(
        'assistant:rate:user',
        signedIn.userId,
      )}`,
    );
    expect(
      keys.filter((key) =>
        key.startsWith('easygenerator:test:assistant:rate:ip:'),
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(keys)).not.toContain(signedIn.userId);
    expect(JSON.stringify(keys)).not.toContain(validSignup.email);
  });

  it('enforces the shared IP assistant budget before provider access', async () => {
    const signedIn = await signUp(app);
    await chat(signedIn, 'sessions').expect(200);
    const redis = app.get<Redis>(REDIS);
    const ipKeys = await scanKeys(
      redis,
      'easygenerator:test:assistant:rate:ip:*',
    );
    expect(ipKeys).toHaveLength(1);
    await redis.set(ipKeys[0]!, '30', 'EX', 60);

    const denied = await chat(signedIn, 'sessions').expect(429);

    expect(problem(denied).code).toBe('RATE_LIMITED');
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect(provider.calls).toHaveLength(1);
  });

  it('enforces the global assistant budget before provider access', async () => {
    const signedIn = await signUp(app);
    await app
      .get<Redis>(REDIS)
      .set('easygenerator:test:assistant:rate:global', '100', 'EX', 60);

    const denied = await chat(signedIn, 'sessions').expect(429);

    expect(problem(denied).code).toBe('RATE_LIMITED');
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect(provider.calls).toHaveLength(0);
  });

  it('fails closed before provider access when Redis is unavailable', async () => {
    const signedIn = await signUp(app);
    const redis = app.get<Redis>(REDIS);
    dockerCompose('stop', 'redis-test');
    try {
      const unavailable = await chat(signedIn, 'sessions').expect(503);
      expect(problem(unavailable).code).toBe(
        'ASSISTANT_PROTECTION_UNAVAILABLE',
      );
      expect(unavailable.headers['cache-control']).toBe('no-store');
      expect(provider.calls).toHaveLength(0);
    } finally {
      dockerCompose('start', 'redis-test');
      await waitForRedis(redis);
    }
  });

  it('rejects a same-user concurrent stream and permits a later stream', async () => {
    const signedIn = await signUp(app);
    const first = chat(signedIn, 'sessions contention');
    const firstCompletion = first.then((response) => response);
    await provider.started;

    const contention = await chat(signedIn, 'sessions contention').expect(429);
    expect(problem(contention).code).toBe('ASSISTANT_STREAM_IN_PROGRESS');
    expect(contention.headers['retry-after']).toBe('35');

    provider.releaseHeldStream();
    await firstCompletion;
    await chat(signedIn, 'sessions architecture').expect(200);
  });

  it('uses compare-delete so stale cleanup cannot delete a newer lease', async () => {
    const signedIn = await signUp(app);
    const leases = app.get(AssistantConcurrencyService);
    const redis = app.get<Redis>(REDIS);
    const first = await leases.acquire(signedIn.userId);
    expect(first.key).toBe(assistantLeaseKey(signedIn.userId));
    expect(first.key).not.toContain(signedIn.userId);
    await redis.del(first.key);
    const second = await leases.acquire(signedIn.userId);

    await leases.release(first);

    expect(await redis.get(second.key)).toBe(second.token);
    await leases.release(second);
  });

  it('maps deadline and provider failure to terminal safe SSE errors', async () => {
    const signedIn = await signUp(app);
    const timeout = parseSse((await chat(signedIn, 'sessions deadline')).text);
    expect(timeout.at(-1)).toEqual({
      type: 'error',
      data: {
        code: 'ASSISTANT_TIMEOUT',
        message: 'The assistant timed out. Please try again.',
      },
    });
    expect(timeout.some((event) => event.type === 'done')).toBe(false);

    const failure = parseSse((await chat(signedIn, 'sessions failure')).text);
    expect(failure.at(-1)).toEqual({
      type: 'error',
      data: {
        code: 'ASSISTANT_PROVIDER_UNAVAILABLE',
        message: 'The assistant is temporarily unavailable. Please try again.',
      },
    });
    expect(JSON.stringify(failure)).not.toContain('private fake provider body');
    expect(failure.some((event) => event.type === 'done')).toBe(false);
  });

  it('releases a stalled lease as soon as late provider finalization succeeds', async () => {
    const signedIn = await signUp(app);
    const timeout = parseSse((await chat(signedIn, 'sessions stalled')).text);
    expect(timeout.at(-1)).toEqual({
      type: 'error',
      data: {
        code: 'ASSISTANT_TIMEOUT',
        message: 'The assistant timed out. Please try again.',
      },
    });

    const redis = app.get<Redis>(REDIS);
    const leaseKey = assistantLeaseKey(signedIn.userId);
    expect(await redis.ttl(leaseKey)).toBeGreaterThan(0);
    const protectedRequest = await chat(
      signedIn,
      'sessions architecture',
    ).expect(429);
    expect(problem(protectedRequest).code).toBe('ASSISTANT_STREAM_IN_PROGRESS');

    provider.releaseStalledStream();
    await provider.stalledFinalized;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await redis.exists(leaseKey)) === 0) break;
      await delay(10);
    }
    expect(await redis.exists(leaseKey)).toBe(0);
    await chat(signedIn, 'sessions architecture').expect(200);
  });

  it('aborts and releases on disconnect so a later stream can start', async () => {
    const signedIn = await signUp(app);
    const pending = chat(signedIn, 'sessions disconnect');
    pending.end(() => undefined);
    await provider.started;
    pending.abort();

    const redis = app.get<Redis>(REDIS);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const active = await redis.exists(assistantLeaseKey(signedIn.userId));
      if (active === 0 && provider.abortObserved) break;
      await delay(10);
    }
    expect(provider.abortObserved).toBe(true);
    expect(await redis.exists(assistantLeaseKey(signedIn.userId))).toBe(0);
    await chat(signedIn, 'sessions architecture').expect(200);
  });
});
