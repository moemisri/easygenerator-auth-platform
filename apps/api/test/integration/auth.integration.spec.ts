import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

describe('authentication HTTP API', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatastores(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('signs up, restores the session, reaches the protected endpoint, and logs out', async () => {
    const agent = request.agent(app.getHttpServer());
    const signup = await agent
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);

    expect(signup.body).toMatchObject({
      user: { email: 'ada@example.com', role: 'USER', status: 'ACTIVE' },
      csrfToken: expect.any(String),
      features: { assistant: false },
    });
    expect(signup.body.user).not.toHaveProperty('passwordHash');
    expect(signup.body.features).toEqual({ assistant: false });
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
    expect(restored.body).toEqual({
      user: signup.body.user,
      csrfToken: signup.body.csrfToken,
      features: { assistant: false },
    });
    expect(restored.headers['cache-control']).toBe('no-store');

    const currentUser = await agent.get('/api/v1/users/me').expect(200);
    expect(currentUser.body).toEqual(signup.body.user);
    expect(currentUser.headers['cache-control']).toBe('no-store');

    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', signup.body.csrfToken as string)
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

    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      fields: expect.arrayContaining([expect.objectContaining({ field })]),
    });
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
    expect(conflict?.body).toMatchObject({
      code: 'EMAIL_ALREADY_REGISTERED',
      status: 409,
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

    expect(signin.body).toMatchObject({
      user: { email: validSignup.email },
      csrfToken: expect.any(String),
      features: { assistant: false },
    });
    expect(signin.body.features).toEqual({ assistant: false });
    expect(signin.headers['cache-control']).toBe('no-store');
    expect(rawCookiePair(setCookieHeader(signin))).not.toBe(
      rawCookiePair(setCookieHeader(signup)),
    );
    expect(signin.body.csrfToken).not.toBe(signup.body.csrfToken);
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
    expect(stableProblem(wrong.body)).toEqual(stableProblem(missing.body));
    expect(stableProblem(disabled.body)).toEqual(stableProblem(missing.body));
    expect(stableProblem(missing.body)).toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it.each([undefined, 'https://localhost:5173.attacker.example'])(
    'rejects signup from a missing or invalid Origin: %s',
    async (origin) => {
      const pending = request(app.getHttpServer()).post('/api/v1/auth/signup');
      if (origin !== undefined) pending.set('Origin', origin);
      await pending
        .send(validSignup)
        .expect(403)
        .expect('Cache-Control', 'no-store');
    },
  );

  it('rejects missing, invalid, and cross-site CSRF evidence', async () => {
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);
    const cookie = rawCookiePair(setCookieHeader(signup));
    const csrfToken = signup.body.csrfToken as string;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'invalid-token')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', appOrigin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);
  });

  it('makes repeated logout with the same valid cookie and CSRF token idempotent', async () => {
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);
    const cookie = rawCookiePair(setCookieHeader(signup));
    const csrfToken = signup.body.csrfToken as string;

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
    await agent
      .get('/api/v1/users/me')
      .expect(401)
      .expect('Cache-Control', 'no-store');
  });

  it('preserves the first fixed-window expiry instead of extending it', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send(validSignup)
      .expect(201);
    const redis = app.get<Redis>(REDIS);
    const [, keys] = await redis.scan(
      '0',
      'MATCH',
      'easygenerator:test:auth-rate-limit:signup:ip:*',
    );
    expect(keys).toHaveLength(1);
    const key = keys[0];
    if (key === undefined) throw new Error('Signup rate-limit key is missing');
    const firstTtl = await redis.ttl(key);

    await delay(1_100);
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send({ ...validSignup, email: 'grace@example.com' })
      .expect(201);

    expect(await redis.ttl(key)).toBeLessThan(firstTtl);
  });

  it('returns Retry-After when the HMAC identity window is blocked', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/signin')
        .set('Origin', appOrigin)
        .send({ email: 'missing@example.com', password: 'Incorrect1!' })
        .expect(401);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/signin')
      .set('Origin', appOrigin)
      .send({ email: 'missing@example.com', password: 'Incorrect1!' })
      .expect(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(900);

    const redis = app.get<Redis>(REDIS);
    const [, rawIdentityKeys] = await redis.scan(
      '0',
      'MATCH',
      '*missing@example.com*',
    );
    expect(rawIdentityKeys).toEqual([]);
  });

  it('returns 503 for signup and signin when Redis protection is unavailable', async () => {
    const redis = app.get<Redis>(REDIS);
    dockerCompose('stop', 'redis-test');
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .set('Origin', appOrigin)
        .send(validSignup)
        .expect(503)
        .expect((response) => {
          expect(response.body).toMatchObject({
            code: 'AUTH_PROTECTION_UNAVAILABLE',
            status: 503,
          });
        });
      await request(app.getHttpServer())
        .post('/api/v1/auth/signin')
        .set('Origin', appOrigin)
        .send({ email: validSignup.email, password: validSignup.password })
        .expect(503)
        .expect((response) => {
          expect(response.body).toMatchObject({
            code: 'AUTH_PROTECTION_UNAVAILABLE',
            status: 503,
          });
        });
    } finally {
      dockerCompose('up', '--wait', 'redis-test');
      await waitForRedis(redis);
    }
  });
});
