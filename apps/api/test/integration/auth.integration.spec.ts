import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  authSessionResponseSchema,
  problemDetailsSchema,
  safeUserSchema,
} from '@easygenerator/contracts';

import { REDIS } from '../../src/platform/redis/redis.constants';
import { createTestApp } from '../support/create-test-app';
import { resetDatastores } from '../support/reset-datastores';

const appOrigin = 'http://localhost:5173';
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const composeFile = path.join(repositoryRoot, 'compose.test.yaml');
const validSignup = {
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  password: 'Secure1!',
};

function setCookieHeader(response: {
  headers: Record<string, unknown>;
}): string {
  const cookies = response.headers['set-cookie'];
  if (!Array.isArray(cookies) || typeof cookies[0] !== 'string') {
    throw new Error('Response did not set a cookie');
  }
  return cookies[0];
}

function rawCookiePair(setCookie: string): string {
  const pair = setCookie.split(';', 1)[0];
  if (pair === undefined) throw new Error('Cookie pair is missing');
  return pair;
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

function expressApplication(app: NestExpressApplication): {
  get(setting: string): unknown;
  set(setting: string, value: unknown): void;
} {
  return app.getHttpAdapter().getInstance() as {
    get(setting: string): unknown;
    set(setting: string, value: unknown): void;
  };
}

describe('authentication HTTP API', () => {
  let app: NestExpressApplication;
  let failingAuditApp: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
    failingAuditApp = await createTestApp({
      auditService: {
        record: () =>
          Promise.reject(new Error('forced downstream audit failure')),
      },
    });
  });

  beforeEach(async () => {
    await resetDatastores(app);
  });

  afterAll(async () => {
    await failingAuditApp?.close();
    await app?.close();
  });

  it('signs up, restores the session, reaches the protected endpoint, and logs out', async () => {
    const agent = request.agent(app.getHttpServer());
    const signup = await agent
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);
    const signupBody = authSessionResponseSchema.parse(signup.body);

    expect(signupBody).toMatchObject({
      user: { email: 'ada@example.com', role: 'USER', status: 'ACTIVE' },
      features: { assistant: false },
    });
    expect(typeof signupBody.csrfToken).toBe('string');
    expect(signupBody.user).not.toHaveProperty('passwordHash');
    expect(signupBody.features).toEqual({ assistant: false });
    expect(signup.headers['cache-control']).toBe('no-store');
    const cookie = setCookieHeader(signup);
    expect(cookie).toContain('session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain('Domain=');

    const restored = await agent.get('/api/v1/auth/session').expect(200);
    expect(authSessionResponseSchema.parse(restored.body)).toEqual({
      user: signupBody.user,
      csrfToken: signupBody.csrfToken,
      features: { assistant: false },
    });
    expect(restored.headers['cache-control']).toBe('no-store');

    const currentUser = await agent.get('/api/v1/users/me').expect(200);
    expect(safeUserSchema.parse(currentUser.body)).toEqual(signupBody.user);
    expect(currentUser.headers['cache-control']).toBe('no-store');

    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', signupBody.csrfToken)
      .expect(204)
      .expect('Cache-Control', 'no-store');
    await agent.get('/api/v1/users/me').expect(401);
  });

  it.each([
    [{ ...validSignup, email: 'not-an-email' }, 'email'],
    [{ ...validSignup, name: 'Al' }, 'name'],
    [{ ...validSignup, password: 'short' }, 'password'],
    [{ ...validSignup, role: 'ADMIN' }, 'request'],
  ])('rejects invalid or unknown signup fields', async (body, field) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(body)
      .expect(400);

    const problem = problemDetailsSchema.parse(response.body);
    expect(problem).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(problem.fields?.some((item) => item.field === field)).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toHaveProperty('stack');
  });

  it('enforces the unique email index during concurrent signup races', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .set('Origin', appOrigin)
        .send(validSignup),
      request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .set('Origin', appOrigin)
        .send({ ...validSignup, email: ' ADA@EXAMPLE.COM ' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const conflict = responses.find((response) => response.status === 409);
    expect(problemDetailsSchema.parse(conflict?.body)).toMatchObject({
      code: 'EMAIL_ALREADY_REGISTERED',
      status: 409,
    });
  });

  it('rolls back user and session writes when signup audit fails', async () => {
    const response = await request(failingAuditApp.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(500);
    expect(response.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    });

    const connection = failingAuditApp.get<Connection>(getConnectionToken());
    const [users, sessions, auditEvents] = await Promise.all([
      connection.collection('users').countDocuments(),
      connection.collection('sessions').countDocuments(),
      connection.collection('auditevents').countDocuments(),
    ]);
    expect({ users, sessions, auditEvents }).toEqual({
      users: 0,
      sessions: 0,
      auditEvents: 0,
    });
  });

  it('signs in with a fresh session and safe feature response', async () => {
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);
    const signin = await request(app.getHttpServer())
      .post('/api/v1/auth/signin')
      .set('Origin', appOrigin)
      .send({ email: ' ADA@EXAMPLE.COM ', password: validSignup.password })
      .expect(200);
    const signupBody = authSessionResponseSchema.parse(signup.body);
    const signinBody = authSessionResponseSchema.parse(signin.body);

    expect(signinBody).toMatchObject({
      user: { email: validSignup.email },
      features: { assistant: false },
    });
    expect(typeof signinBody.csrfToken).toBe('string');
    expect(signinBody.features).toEqual({ assistant: false });
    expect(signin.headers['cache-control']).toBe('no-store');
    expect(rawCookiePair(setCookieHeader(signin))).not.toBe(
      rawCookiePair(setCookieHeader(signup)),
    );
    expect(signinBody.csrfToken).not.toBe(signupBody.csrfToken);
    expect(
      await scanKeys(
        app.get<Redis>(REDIS),
        'easygenerator:test:rate-limit:auth:signin:*',
      ),
    ).toEqual([]);
  });

  it('returns indistinguishable signin failures for unknown, wrong, and disabled users', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);

    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/signin')
      .set('Origin', appOrigin)
      .send({ email: validSignup.email, password: 'Incorrect1!' })
      .expect(401);
    const missing = await request(app.getHttpServer())
      .post('/api/v1/auth/signin')
      .set('Origin', appOrigin)
      .send({ email: 'missing@example.com', password: 'Incorrect1!' })
      .expect(401);

    const connection = app.get<Connection>(getConnectionToken());
    await connection
      .collection('users')
      .updateOne(
        { emailKey: validSignup.email },
        { $set: { status: 'DISABLED' } },
      );
    const disabled = await request(app.getHttpServer())
      .post('/api/v1/auth/signin')
      .set('Origin', appOrigin)
      .send({ email: validSignup.email, password: validSignup.password })
      .expect(401);

    const stableProblem = (body: Record<string, unknown>) => ({
      type: body.type,
      title: body.title,
      status: body.status,
      code: body.code,
    });
    const wrongBody = problemDetailsSchema.parse(wrong.body);
    const missingBody = problemDetailsSchema.parse(missing.body);
    const disabledBody = problemDetailsSchema.parse(disabled.body);
    expect(stableProblem(wrongBody)).toEqual(stableProblem(missingBody));
    expect(stableProblem(disabledBody)).toEqual(stableProblem(missingBody));
    expect(stableProblem(missingBody)).toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it.each([undefined, 'https://localhost:5173.attacker.example'])(
    'rejects signup from a missing or invalid Origin: %s',
    async (origin) => {
      const pending = request(app.getHttpServer()).post('/api/v1/auth/signup');
      if (origin !== undefined) pending.set('Origin', origin);
      const response = await pending
        .send(validSignup)
        .expect(403)
        .expect('Cache-Control', 'no-store');
      expect(problemDetailsSchema.parse(response.body).status).toBe(403);
    },
  );

  it('rejects missing, invalid, and cross-site CSRF evidence', async () => {
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);
    const cookie = rawCookiePair(setCookieHeader(signup));
    const csrfToken = authSessionResponseSchema.parse(signup.body).csrfToken;

    const missing = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('Cookie', cookie)
      .expect(403);
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'invalid-token')
      .expect(403);
    const crossSite = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);
    expect(
      [missing, invalid, crossSite].map(
        (response) => problemDetailsSchema.parse(response.body).status,
      ),
    ).toEqual([403, 403, 403]);
  });

  it('makes repeated logout with the same valid cookie and CSRF token idempotent', async () => {
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);
    const cookie = rawCookiePair(setCookieHeader(signup));
    const csrfToken = authSessionResponseSchema.parse(signup.body).csrfToken;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const logout = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', appOrigin)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfToken)
        .expect(204);
      const clearedCookie = setCookieHeader(logout);
      expect(clearedCookie).toContain('session=;');
      expect(clearedCookie).toContain('HttpOnly');
      expect(clearedCookie).toContain('SameSite=Strict');
      expect(clearedCookie).toContain('Path=/');
      expect(clearedCookie).not.toContain('Secure');
      expect(clearedCookie).not.toContain('Domain=');
    }
  });

  it('rejects an expired persisted session synchronously', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);
    const connection = app.get<Connection>(getConnectionToken());
    await connection
      .collection('sessions')
      .updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1_000) } });

    await agent
      .get('/api/v1/auth/session')
      .expect(401)
      .expect('Cache-Control', 'no-store');
    const connectionAfterRejection = app.get<Connection>(getConnectionToken());
    const rejectionEvent = await connectionAfterRejection
      .collection('auditevents')
      .findOne({
        action: 'SESSION_REJECTED',
        'metadata.reason': 'EXPIRED',
      });
    expect(typeof rejectionEvent?.actorId).toBe('string');
    await agent
      .get('/api/v1/users/me')
      .expect(401)
      .expect('Cache-Control', 'no-store');
  });

  it('preserves the first fixed-window expiry instead of extending it', async () => {
    const trustedIpSentinel = '198.51.100.23';
    const expressApp = expressApplication(app);
    const previousTrustProxy = expressApp.get('trust proxy');
    expressApp.set('trust proxy', 1);
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .set('Origin', appOrigin)
        .set('X-Forwarded-For', trustedIpSentinel)
        .send(validSignup)
        .expect(201);
      const redis = app.get<Redis>(REDIS);
      const keys = await scanKeys(
        redis,
        'easygenerator:test:rate-limit:auth:signup:ip:*',
      );
      expect(keys).toEqual([
        `easygenerator:test:rate-limit:auth:signup:ip:${privacyDigest(
          'auth:signup:ip',
          trustedIpSentinel,
        )}`,
      ]);
      expect(keys[0]).not.toContain(trustedIpSentinel);
      const key = keys[0];
      if (key === undefined)
        throw new Error('Signup rate-limit key is missing');
      const firstTtl = await redis.ttl(key);

      await delay(1_100);
      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .set('Origin', appOrigin)
        .set('X-Forwarded-For', trustedIpSentinel)
        .send({ ...validSignup, email: 'grace@example.com' })
        .expect(201);

      expect(await redis.ttl(key)).toBeLessThan(firstTtl);
    } finally {
      expressApp.set('trust proxy', previousTrustProxy);
    }
  });

  it('returns Retry-After when the HMAC identity window is blocked', async () => {
    const trustedIpSentinel = '198.51.100.24';
    const expressApp = expressApplication(app);
    const previousTrustProxy = expressApp.get('trust proxy');
    expressApp.set('trust proxy', 1);
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/signin')
          .set('Origin', appOrigin)
          .set('X-Forwarded-For', trustedIpSentinel)
          .send({ email: 'missing@example.com', password: 'Incorrect1!' })
          .expect(401);
      }

      const blocked = await request(app.getHttpServer())
        .post('/api/v1/auth/signin')
        .set('Origin', appOrigin)
        .set('X-Forwarded-For', trustedIpSentinel)
        .send({ email: 'missing@example.com', password: 'Incorrect1!' })
        .expect(429);
      expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(900);

      const keys = await scanKeys(
        app.get<Redis>(REDIS),
        'easygenerator:test:rate-limit:auth:signin:*',
      );
      expect(keys).toEqual(
        [
          `easygenerator:test:rate-limit:auth:signin:identity:${privacyDigest(
            'auth:signin:identity',
            'missing@example.com',
          )}`,
          `easygenerator:test:rate-limit:auth:signin:ip:${privacyDigest(
            'auth:signin:ip',
            trustedIpSentinel,
          )}`,
        ].sort(),
      );
      expect(JSON.stringify(keys)).not.toContain('missing@example.com');
      expect(JSON.stringify(keys)).not.toContain(trustedIpSentinel);
    } finally {
      expressApp.set('trust proxy', previousTrustProxy);
    }
  });

  it('atomically charges concurrent failed signins at limit minus one', async () => {
    const trustedIpSentinel = '198.51.100.25';
    const identity = 'concurrent-missing@example.com';
    const redis = app.get<Redis>(REDIS);
    const ipKey = `easygenerator:test:rate-limit:auth:signin:ip:${privacyDigest(
      'auth:signin:ip',
      trustedIpSentinel,
    )}`;
    const identityKey = `easygenerator:test:rate-limit:auth:signin:identity:${privacyDigest(
      'auth:signin:identity',
      identity,
    )}`;
    await redis
      .multi()
      .set(ipKey, '9', 'EX', 120)
      .set(identityKey, '4', 'EX', 240)
      .exec();

    const expressApp = expressApplication(app);
    const previousTrustProxy = expressApp.get('trust proxy');
    expressApp.set('trust proxy', 1);
    try {
      const responses = await Promise.all(
        Array.from({ length: 2 }, () =>
          request(app.getHttpServer())
            .post('/api/v1/auth/signin')
            .set('Origin', appOrigin)
            .set('X-Forwarded-For', trustedIpSentinel)
            .send({ email: identity, password: 'Incorrect1!' }),
        ),
      );

      expect(responses.map(({ status }) => status).sort()).toEqual([401, 429]);
      const blocked = responses.find(({ status }) => status === 429);
      if (blocked === undefined) throw new Error('Expected one blocked signin');
      expect(problemDetailsSchema.parse(blocked.body)).toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
      });

      const [ipCount, identityCount, ipTtl, identityTtl] = await Promise.all([
        redis.get(ipKey),
        redis.get(identityKey),
        redis.ttl(ipKey),
        redis.ttl(identityKey),
      ]);
      expect([ipCount, identityCount]).toEqual(['11', '6']);
      expect(identityTtl).toBeGreaterThan(ipTtl);
      const retryAfter = Number(blocked.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(ipTtl);
      expect(Math.abs(retryAfter - identityTtl)).toBeLessThanOrEqual(1);

      await request(app.getHttpServer())
        .post('/api/v1/auth/signin')
        .set('Origin', appOrigin)
        .set('X-Forwarded-For', trustedIpSentinel)
        .send({ email: identity, password: 'Incorrect1!' })
        .expect(429);
      expect(await redis.mget(ipKey, identityKey)).toEqual(['11', '6']);
    } finally {
      expressApp.set('trust proxy', previousTrustProxy);
    }
  });

  it('returns 503 for signup and signin when Redis protection is unavailable', async () => {
    const redis = app.get<Redis>(REDIS);
    dockerCompose('stop', 'redis-test');
    try {
      const signupUnavailable = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .set('Origin', appOrigin)
        .send(validSignup)
        .expect(503);
      expect(problemDetailsSchema.parse(signupUnavailable.body)).toMatchObject({
        code: 'AUTH_PROTECTION_UNAVAILABLE',
        status: 503,
      });
      const signinUnavailable = await request(app.getHttpServer())
        .post('/api/v1/auth/signin')
        .set('Origin', appOrigin)
        .send({ email: validSignup.email, password: validSignup.password })
        .expect(503);
      expect(problemDetailsSchema.parse(signinUnavailable.body)).toMatchObject({
        code: 'AUTH_PROTECTION_UNAVAILABLE',
        status: 503,
      });
    } finally {
      dockerCompose('up', '--wait', 'redis-test');
      await waitForRedis(redis);
    }
  });
});
