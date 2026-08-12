import { once } from 'node:events';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  adminAuditEventsResponseSchema,
  adminUsersResponseSchema,
  authSessionResponseSchema,
  problemDetailsSchema,
  safeUserSchema,
} from '@easygenerator/contracts';

import { bootstrapFirstAdmin } from '../../src/cli/bootstrap-admin';
import { AdminRepository } from '../../src/modules/admin/admin.repository';
import { AuditService } from '../../src/modules/audit/audit.service';
import { PasswordService } from '../../src/modules/auth/password.service';
import { UsersService } from '../../src/modules/users/users.service';
import { REDIS } from '../../src/platform/redis/redis.constants';
import { createTestApp } from '../support/create-test-app';
import { resetDatastores } from '../support/reset-datastores';

const appOrigin = 'http://localhost:5173';

interface SignedInUser {
  agent: ReturnType<typeof request.agent>;
  cookie: string;
  csrfToken: string;
  user: {
    id: string;
    version: number;
  };
}

function setCookieHeader(response: {
  headers: Record<string, unknown>;
}): string {
  const cookies = response.headers['set-cookie'];
  if (!Array.isArray(cookies) || typeof cookies[0] !== 'string') {
    throw new Error('Response did not set a cookie');
  }
  const pair = cookies[0].split(';', 1)[0];
  if (pair === undefined) throw new Error('Cookie pair is missing');
  return pair;
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

function expressApplication(app: NestExpressApplication): {
  get(setting: string): unknown;
  set(setting: string, value: unknown): void;
} {
  return app.getHttpAdapter().getInstance() as {
    get(setting: string): unknown;
    set(setting: string, value: unknown): void;
  };
}

describe('administration HTTP API', () => {
  let app: NestExpressApplication;
  let failingAuditApp: NestExpressApplication;
  let outageApp: NestExpressApplication;
  let connection: Connection;

  beforeAll(async () => {
    app = await createTestApp();
    failingAuditApp = await createTestApp({
      auditService: {
        record: () =>
          Promise.reject(new Error('forced administrative audit failure')),
      },
    });
    outageApp = await createTestApp();
    connection = app.get<Connection>(getConnectionToken());
  });

  beforeEach(async () => {
    await resetDatastores(app);
  });

  afterAll(async () => {
    await outageApp?.close();
    await failingAuditApp?.close();
    await app?.close();
  });

  async function signUp(
    email: string,
    name = 'Example User',
    targetApp = app,
  ): Promise<SignedInUser> {
    const agent = request.agent(targetApp.getHttpServer());
    const response = await agent
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send({ email, name, password: 'Secure1!' })
      .expect(201);
    const body = authSessionResponseSchema.parse(response.body);
    return {
      agent,
      cookie: setCookieHeader(response),
      csrfToken: body.csrfToken,
      user: body.user,
    };
  }

  async function setRole(email: string, role: string): Promise<void> {
    await connection
      .collection('users')
      .updateOne({ emailKey: email.toLowerCase() }, { $set: { role } });
  }

  async function patchUser(
    actor: SignedInUser,
    targetId: string,
    body: Record<string, unknown>,
  ) {
    return actor.agent
      .patch(`/api/v1/admin/users/${targetId}`)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', actor.csrfToken)
      .send(body);
  }

  it('denies USER, allows SUPPORT reads, and keeps SUPPORT read-only', async () => {
    const unauthenticated = await request(app.getHttpServer())
      .get('/API/V1/ADMIN/USERS')
      .expect(401);
    expect(problemDetailsSchema.parse(unauthenticated.body).code).toBe(
      'UNAUTHENTICATED',
    );
    expect(unauthenticated.headers['cache-control']).toBe('no-store');

    const basic = await signUp('basic@example.com', 'Basic User');
    const basicDenied = await basic.agent
      .get('/API/V1/ADMIN/USERS')
      .expect(403);
    expect(problemDetailsSchema.parse(basicDenied.body).code).toBe(
      'INSUFFICIENT_CAPABILITY',
    );
    expect(basicDenied.headers['cache-control']).toBe('no-store');

    const support = await signUp('support@example.com', 'Support User');
    await setRole('support@example.com', 'SUPPORT');
    const users = await support.agent
      .get('/api/v1/admin/users')
      .query({ page: 1, pageSize: 20 })
      .expect(200);
    expect(adminUsersResponseSchema.parse(users.body).total).toBe(2);
    expect(users.headers['cache-control']).toBe('no-store');
    await support.agent
      .get('/api/v1/admin/audit-events')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    const mutation = await patchUser(support, basic.user.id, {
      version: 0,
      status: 'DISABLED',
    });
    expect(mutation.status).toBe(403);
    expect(problemDetailsSchema.parse(mutation.body).code).toBe(
      'INSUFFICIENT_CAPABILITY',
    );
    expect(mutation.headers['cache-control']).toBe('no-store');
  });

  it('enforces the complete manager target boundary', async () => {
    const manager = await signUp('manager@example.com', 'Manager User');
    const basic = await signUp('basic@example.com', 'Basic User');
    const support = await signUp('support@example.com', 'Support User');
    const privileged = await signUp('admin@example.com', 'Admin User');
    await setRole('manager@example.com', 'MANAGER');
    await setRole('support@example.com', 'SUPPORT');
    await setRole('admin@example.com', 'ADMIN');

    const allowed = await patchUser(manager, basic.user.id, {
      version: 0,
      role: 'SUPPORT',
    });
    expect(allowed.status).toBe(200);
    expect(safeUserSchema.parse(allowed.body)).toMatchObject({
      role: 'SUPPORT',
      version: 1,
    });

    for (const [targetId, body] of [
      [manager.user.id, { version: 0, status: 'DISABLED' }],
      [support.user.id, { version: 0, role: 'MANAGER' }],
      [privileged.user.id, { version: 0, status: 'DISABLED' }],
    ] as const) {
      const denied = await patchUser(manager, targetId, body);
      expect(denied.status).toBe(403);
      expect(problemDetailsSchema.parse(denied.body).code).toBe(
        'TARGET_UPDATE_FORBIDDEN',
      );
      expect(denied.headers['cache-control']).toBe('no-store');
    }
  });

  it('validates admin user IDs before persistence lookup', async () => {
    const admin = await signUp('admin@example.com', 'Admin User');
    await setRole('admin@example.com', 'ADMIN');

    const malformed = await patchUser(admin, 'not-an-object-id', {
      version: 0,
      status: 'DISABLED',
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: [expect.objectContaining({ field: 'id' })],
    });
    expect(malformed.headers['cache-control']).toBe('no-store');

    const absent = await patchUser(admin, '507f1f77bcf86cd799439099', {
      version: 0,
      status: 'DISABLED',
    });
    expect(absent.status).toBe(404);
    expect(problemDetailsSchema.parse(absent.body).code).toBe('USER_NOT_FOUND');
    expect(absent.headers['cache-control']).toBe('no-store');
  });

  it('allows ADMIN privileged changes, forbids self-edit, and makes stale writes atomic', async () => {
    const admin = await signUp('admin@example.com', 'Admin User');
    const manager = await signUp('manager@example.com', 'Manager User');
    const basic = await signUp('basic@example.com', 'Basic User');
    await setRole('admin@example.com', 'ADMIN');
    await setRole('manager@example.com', 'MANAGER');

    const promoted = await patchUser(admin, manager.user.id, {
      version: 0,
      role: 'ADMIN',
    });
    expect(promoted.status).toBe(200);
    expect(safeUserSchema.parse(promoted.body)).toMatchObject({
      role: 'ADMIN',
      version: 1,
    });

    const selfEdit = await patchUser(admin, admin.user.id, {
      version: 0,
      status: 'DISABLED',
    });
    expect(selfEdit.status).toBe(403);
    expect(problemDetailsSchema.parse(selfEdit.body).code).toBe(
      'TARGET_UPDATE_FORBIDDEN',
    );

    const stale = await patchUser(admin, basic.user.id, {
      version: 99,
      status: 'DISABLED',
    });
    expect(stale.status).toBe(409);
    expect(problemDetailsSchema.parse(stale.body).code).toBe(
      'STALE_USER_VERSION',
    );
    const stored = await connection
      .collection('users')
      .findOne({ _id: new connection.base.Types.ObjectId(basic.user.id) });
    expect(stored).toMatchObject({ status: 'ACTIVE', version: 0 });
    await basic.agent.get('/api/v1/users/me').expect(200);
    expect(
      await connection
        .collection('auditevents')
        .countDocuments({ targetId: basic.user.id }),
    ).toBe(0);
  });

  it('rate-limits the 21st authorized PATCH with only private actor and trusted-IP keys', async () => {
    const admin = await signUp('admin@example.com', 'Admin User');
    const target = await signUp('target@example.com', 'Target User');
    await setRole('admin@example.com', 'ADMIN');
    const trustedIpSentinel = '198.51.100.91';
    const expressApp = expressApplication(app);
    const previousTrustProxy = expressApp.get('trust proxy');
    expressApp.set('trust proxy', 1);
    try {
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        const stale = await admin.agent
          .patch(`/api/v1/admin/users/${target.user.id}`)
          .set('Origin', appOrigin)
          .set('X-CSRF-Token', admin.csrfToken)
          .set('X-Forwarded-For', trustedIpSentinel)
          .send({ version: 99, status: 'DISABLED' })
          .expect(409);
        expect(problemDetailsSchema.parse(stale.body).code).toBe(
          'STALE_USER_VERSION',
        );
      }

      const blocked = await admin.agent
        .patch(`/api/v1/admin/users/${target.user.id}`)
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', admin.csrfToken)
        .set('X-Forwarded-For', trustedIpSentinel)
        .send({ version: 99, status: 'DISABLED' })
        .expect(429);
      expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(blocked.headers['cache-control']).toBe('no-store');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);

      const keys = await scanKeys(
        app.get<Redis>(REDIS),
        'easygenerator:test:rate-limit:admin-mutation:*',
      );
      expect(keys).toHaveLength(2);
      expect(keys).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^easygenerator:test:rate-limit:admin-mutation:actor:[A-Za-z0-9_-]{43}$/,
          ),
          expect.stringMatching(
            /^easygenerator:test:rate-limit:admin-mutation:ip:[A-Za-z0-9_-]{43}$/,
          ),
        ]),
      );
      expect(JSON.stringify(keys)).not.toContain(admin.user.id);
      expect(JSON.stringify(keys)).not.toContain(trustedIpSentinel);

      const stored = await connection.collection('users').findOne({
        _id: new connection.base.Types.ObjectId(target.user.id),
      });
      expect(stored).toMatchObject({ status: 'ACTIVE', version: 0 });
      expect(
        await connection
          .collection('auditevents')
          .countDocuments({ targetId: target.user.id }),
      ).toBe(0);
    } finally {
      expressApp.set('trust proxy', previousTrustProxy);
    }
    expect(expressApp.get('trust proxy')).toBe(previousTrustProxy);
  });

  it('keeps admin GETs available but fails PATCH closed when its Redis client ends', async () => {
    const admin = await signUp(
      'outage-admin@example.com',
      'Outage Admin',
      outageApp,
    );
    const target = await signUp(
      'outage-target@example.com',
      'Outage Target',
      outageApp,
    );
    await setRole('outage-admin@example.com', 'ADMIN');
    const beforeAuditCount = await connection
      .collection('auditevents')
      .countDocuments();
    const redis = outageApp.get<Redis>(REDIS);
    const ended = once(redis, 'end');
    redis.disconnect();
    await ended;

    await admin.agent
      .get('/api/v1/admin/users')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await admin.agent
      .get('/api/v1/admin/audit-events')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const unavailable = await admin.agent
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', admin.csrfToken)
      .send({ version: 0, status: 'DISABLED' })
      .expect(503);
    expect(unavailable.body).toMatchObject({
      code: 'ADMIN_MUTATION_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    expect(unavailable.headers['cache-control']).toBe('no-store');

    const stored = await connection.collection('users').findOne({
      _id: new connection.base.Types.ObjectId(target.user.id),
    });
    expect(stored).toMatchObject({ status: 'ACTIVE', version: 0 });
    expect(await connection.collection('auditevents').countDocuments()).toBe(
      beforeAuditCount,
    );
  });

  it('commits version, per-field audits, and all-session revocation together', async () => {
    const admin = await signUp('admin@example.com', 'Admin User');
    const target = await signUp('target@example.com', 'Target User');
    await setRole('admin@example.com', 'ADMIN');

    const updated = await patchUser(admin, target.user.id, {
      version: 0,
      role: 'SUPPORT',
      status: 'DISABLED',
    });
    expect(updated.status).toBe(200);
    expect(updated.headers['cache-control']).toBe('no-store');
    expect(safeUserSchema.parse(updated.body)).toMatchObject({
      role: 'SUPPORT',
      status: 'DISABLED',
      version: 1,
    });
    await target.agent.get('/api/v1/users/me').expect(401);

    const events = await admin.agent
      .get('/api/v1/admin/audit-events')
      .query({ pageSize: 50 })
      .expect(200);
    const eventsBody = adminAuditEventsResponseSchema.parse(events.body);
    const targetEvents = eventsBody.items.filter((event) =>
      event.action.startsWith('USER_'),
    );
    expect(targetEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining(['USER_ROLE_CHANGED', 'USER_STATUS_CHANGED']),
    );
    for (const event of targetEvents) {
      expect(Object.keys(event).sort()).toEqual([
        'action',
        'id',
        'occurredAt',
        'summary',
      ]);
    }
    expect(
      await connection.collection('sessions').countDocuments({
        userId: new connection.base.Types.ObjectId(target.user.id),
        revokedAt: { $ne: null },
      }),
    ).toBeGreaterThan(0);
  });

  it('rolls back user, session, security state, and audits when audit persistence fails', async () => {
    const admin = await signUp('admin@example.com', 'Admin User');
    const target = await signUp('target@example.com', 'Target User');
    await setRole('admin@example.com', 'ADMIN');

    const failed = await request(failingAuditApp.getHttpServer())
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Origin', appOrigin)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrfToken)
      .send({ version: 0, status: 'DISABLED' });
    expect(failed.status).toBe(500);
    expect(problemDetailsSchema.parse(failed.body).code).toBe('INTERNAL_ERROR');
    expect(failed.headers['cache-control']).toBe('no-store');

    const stored = await connection
      .collection('users')
      .findOne({ _id: new connection.base.Types.ObjectId(target.user.id) });
    expect(stored).toMatchObject({ status: 'ACTIVE', version: 0 });
    await target.agent.get('/api/v1/users/me').expect(200);
    expect(
      await connection
        .collection('auditevents')
        .countDocuments({ action: 'USER_STATUS_CHANGED' }),
    ).toBe(0);
    expect(await connection.collection('securitystates').countDocuments()).toBe(
      0,
    );
  });

  it('escapes literal search, paginates deterministically, and returns global summary', async () => {
    const support = await signUp('support@example.com', 'Support User');
    await signUp('literal@example.com', 'Ada.* Literal');
    await signUp('regex@example.com', 'Adax Regex');
    await signUp('grace@example.com', 'Grace Hopper');
    await setRole('support@example.com', 'SUPPORT');

    const literal = await support.agent
      .get('/api/v1/admin/users')
      .query({ search: 'Ada.*', sort: 'name', direction: 'asc' })
      .expect(200);
    const literalBody = adminUsersResponseSchema.parse(literal.body);
    expect(literalBody.total).toBe(1);
    expect(literalBody.items.map((user) => user.name)).toEqual([
      'Ada.* Literal',
    ]);
    expect(literalBody.summary).toEqual({ total: 4, active: 4 });

    const first = await support.agent
      .get('/api/v1/admin/users')
      .query({ page: 1, pageSize: 1, sort: 'name', direction: 'asc' })
      .expect(200);
    const second = await support.agent
      .get('/api/v1/admin/users')
      .query({ page: 2, pageSize: 1, sort: 'name', direction: 'asc' })
      .expect(200);
    const firstBody = adminUsersResponseSchema.parse(first.body);
    const secondBody = adminUsersResponseSchema.parse(second.body);
    expect(firstBody.total).toBe(4);
    expect(firstBody.items[0]?.id).not.toBe(secondBody.items[0]?.id);
  });

  it('redacts audit persistence fields and arbitrary metadata from SUPPORT', async () => {
    const support = await signUp('support@example.com', 'Support User');
    await setRole('support@example.com', 'SUPPORT');
    await request(app.getHttpServer())
      .post('/api/v1/auth/signin')
      .set('Origin', appOrigin)
      .send({ email: 'missing@example.com', password: 'Incorrect1!' })
      .expect(401);

    await connection
      .collection('auditevents')
      .updateOne(
        { action: 'AUTH_SIGNIN_FAILED' },
        { $set: { 'metadata.injected': 'raw-json-secret' } },
      );
    const response = await support.agent
      .get('/api/v1/admin/audit-events')
      .query({ page: 1, pageSize: 50 })
      .expect(200);
    const responseBody = adminAuditEventsResponseSchema.parse(response.body);
    const rejected = responseBody.items.find(
      (event) => event.action === 'AUTH_SIGNIN_FAILED',
    );
    if (rejected === undefined) {
      throw new Error('Expected a rejected sign-in audit event');
    }
    expect(rejected).toMatchObject({
      summary: 'A sign-in attempt was rejected.',
    });
    expect(Object.keys(rejected).sort()).toEqual([
      'action',
      'id',
      'occurredAt',
      'summary',
    ]);
    expect(JSON.stringify(responseBody)).not.toContain('identityDigest');
    expect(JSON.stringify(responseBody)).not.toContain('raw-json-secret');
    expect(JSON.stringify(responseBody)).not.toContain('requestId');
  });

  it('requires exact Origin and CSRF evidence on mutations with no-store errors', async () => {
    const admin = await signUp('admin@example.com', 'Admin User');
    const target = await signUp('target@example.com', 'Target User');
    await setRole('admin@example.com', 'ADMIN');

    const missingOrigin = await request(app.getHttpServer())
      .patch(`/API/V1/ADMIN/USERS/${target.user.id}`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrfToken)
      .send({ version: 0, role: 'SUPPORT' });
    expect(missingOrigin.status).toBe(403);
    expect(problemDetailsSchema.parse(missingOrigin.body).code).toBe(
      'HTTP_403',
    );
    expect(missingOrigin.headers['cache-control']).toBe('no-store');

    const missingCsrf = await request(app.getHttpServer())
      .patch(`/API/V1/ADMIN/USERS/${target.user.id}`)
      .set('Origin', appOrigin)
      .set('Cookie', admin.cookie)
      .send({ version: 0, role: 'SUPPORT' });
    expect(missingCsrf.status).toBe(403);
    expect(problemDetailsSchema.parse(missingCsrf.body).code).toBe(
      'CSRF_VALIDATION_FAILED',
    );
    expect(missingCsrf.headers['cache-control']).toBe('no-store');

    await patchUser(admin, target.user.id, {
      version: 0,
      role: 'SUPPORT',
    }).then((response) => expect(response.status).toBe(200));
  });

  it('rejects a duplicate concurrent admin removal with an exact stale-version conflict', async () => {
    const first = await signUp('first-admin@example.com', 'First Admin');
    const second = await signUp('second-admin@example.com', 'Second Admin');
    await setRole('first-admin@example.com', 'ADMIN');
    await setRole('second-admin@example.com', 'ADMIN');
    await connection
      .collection('securitystates')
      .insertOne({ key: 'authorization', revision: 0 });

    const responses = await Promise.all([
      patchUser(first, second.user.id, { version: 0, status: 'DISABLED' }),
      patchUser(first, second.user.id, { version: 0, status: 'DISABLED' }),
    ]);

    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    const rejected = responses.filter((response) => response.status !== 200);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status).toBe(409);
    expect(problemDetailsSchema.parse(rejected[0]?.body).code).toBe(
      'STALE_USER_VERSION',
    );
    expect(
      await connection.collection('users').countDocuments({
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    ).toBe(1);
  });

  it('serializes cross-admin removals and leaves exactly one active admin', async () => {
    const first = await signUp('first-admin@example.com', 'First Admin');
    const second = await signUp('second-admin@example.com', 'Second Admin');
    await setRole('first-admin@example.com', 'ADMIN');
    await setRole('second-admin@example.com', 'ADMIN');
    await connection
      .collection('securitystates')
      .insertOne({ key: 'authorization', revision: 0 });

    const responses = await Promise.all([
      patchUser(first, second.user.id, { version: 0, status: 'DISABLED' }),
      patchUser(second, first.user.id, { version: 0, status: 'DISABLED' }),
    ]);

    const outcomes = responses
      .map((response) => ({
        status: response.status,
        code:
          response.status === 200
            ? null
            : problemDetailsSchema.parse(response.body).code,
        cacheControl: response.headers['cache-control'],
      }))
      .sort((left, right) => left.status - right.status);
    const activeAdminCount = await connection
      .collection('users')
      .countDocuments({
        role: 'ADMIN',
        status: 'ACTIVE',
      });

    expect({ outcomes, activeAdminCount }).toEqual({
      outcomes: [
        { status: 200, code: null, cacheControl: 'no-store' },
        {
          status: 401,
          code: 'UNAUTHENTICATED',
          cacheControl: 'no-store',
        },
      ],
      activeAdminCount: 1,
    });
  });

  it('allows exactly one concurrent first-admin bootstrap', async () => {
    const dependencies = {
      users: app.get(UsersService),
      passwords: app.get(PasswordService),
      audit: app.get(AuditService),
      security: app.get(AdminRepository),
      connection,
    };
    const results = await Promise.allSettled([
      bootstrapFirstAdmin(
        {
          ADMIN_EMAIL: 'first@example.com',
          ADMIN_NAME: 'First Admin',
          ADMIN_PASSWORD: 'Secure1!',
        },
        dependencies,
      ),
      bootstrapFirstAdmin(
        {
          ADMIN_EMAIL: 'second@example.com',
          ADMIN_NAME: 'Second Admin',
          ADMIN_PASSWORD: 'Secure1!',
        },
        dependencies,
      ),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await connection.collection('users').countDocuments({
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    ).toBe(1);
    expect(
      await connection
        .collection('auditevents')
        .countDocuments({ action: 'ADMIN_BOOTSTRAPPED' }),
    ).toBe(1);
  });
});
