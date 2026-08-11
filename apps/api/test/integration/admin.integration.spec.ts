import type { NestExpressApplication } from '@nestjs/platform-express';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bootstrapFirstAdmin } from '../../src/cli/bootstrap-admin';
import { AdminRepository } from '../../src/modules/admin/admin.repository';
import { AuditService } from '../../src/modules/audit/audit.service';
import { PasswordService } from '../../src/modules/auth/password.service';
import { UsersService } from '../../src/modules/users/users.service';
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

describe('administration HTTP API', () => {
  let app: NestExpressApplication;
  let failingAuditApp: NestExpressApplication;
  let connection: Connection;

  beforeAll(async () => {
    app = await createTestApp();
    failingAuditApp = await createTestApp({
      auditService: {
        record: async () => {
          throw new Error('forced administrative audit failure');
        },
      },
    });
    connection = app.get<Connection>(getConnectionToken());
  });

  beforeEach(async () => {
    await resetDatastores(app);
  });

  afterAll(async () => {
    await failingAuditApp?.close();
    await app?.close();
  });

  async function signUp(
    email: string,
    name = 'Example User',
  ): Promise<SignedInUser> {
    const agent = request.agent(app.getHttpServer());
    const response = await agent
      .post('/api/v1/auth/signup')
      .set('Origin', appOrigin)
      .send({ email, name, password: 'Secure1!' })
      .expect(201);
    return {
      agent,
      cookie: setCookieHeader(response),
      csrfToken: response.body.csrfToken as string,
      user: response.body.user as SignedInUser['user'],
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
      .get('/api/v1/admin/users')
      .expect(401);
    expect(unauthenticated.body.code).toBe('UNAUTHENTICATED');
    expect(unauthenticated.headers['cache-control']).toBe('no-store');

    const basic = await signUp('basic@example.com', 'Basic User');
    const basicDenied = await basic.agent
      .get('/api/v1/admin/users')
      .expect(403);
    expect(basicDenied.body.code).toBe('INSUFFICIENT_CAPABILITY');
    expect(basicDenied.headers['cache-control']).toBe('no-store');

    const support = await signUp('support@example.com', 'Support User');
    await setRole('support@example.com', 'SUPPORT');
    const users = await support.agent
      .get('/api/v1/admin/users')
      .query({ page: 1, pageSize: 20 })
      .expect(200);
    expect(users.body.total).toBe(2);
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
    expect(mutation.body.code).toBe('INSUFFICIENT_CAPABILITY');
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
    expect(allowed.body).toMatchObject({ role: 'SUPPORT', version: 1 });

    for (const [targetId, body] of [
      [manager.user.id, { version: 0, status: 'DISABLED' }],
      [support.user.id, { version: 0, role: 'MANAGER' }],
      [privileged.user.id, { version: 0, status: 'DISABLED' }],
    ] as const) {
      const denied = await patchUser(manager, targetId, body);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('TARGET_UPDATE_FORBIDDEN');
      expect(denied.headers['cache-control']).toBe('no-store');
    }
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
    expect(promoted.body).toMatchObject({ role: 'ADMIN', version: 1 });

    const selfEdit = await patchUser(admin, admin.user.id, {
      version: 0,
      status: 'DISABLED',
    });
    expect(selfEdit.status).toBe(403);
    expect(selfEdit.body.code).toBe('TARGET_UPDATE_FORBIDDEN');

    const stale = await patchUser(admin, basic.user.id, {
      version: 99,
      status: 'DISABLED',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_USER_VERSION');
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
    expect(updated.body).toMatchObject({
      role: 'SUPPORT',
      status: 'DISABLED',
      version: 1,
    });
    await target.agent.get('/api/v1/users/me').expect(401);

    const events = await admin.agent
      .get('/api/v1/admin/audit-events')
      .query({ pageSize: 50 })
      .expect(200);
    const targetEvents = events.body.items.filter((event: { action: string }) =>
      event.action.startsWith('USER_'),
    );
    expect(
      targetEvents.map((event: { action: string }) => event.action),
    ).toEqual(
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
    expect(failed.body.code).toBe('INTERNAL_ERROR');
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
    expect(literal.body.total).toBe(1);
    expect(
      literal.body.items.map((user: { name: string }) => user.name),
    ).toEqual(['Ada.* Literal']);
    expect(literal.body.summary).toEqual({ total: 4, active: 4 });

    const first = await support.agent
      .get('/api/v1/admin/users')
      .query({ page: 1, pageSize: 1, sort: 'name', direction: 'asc' })
      .expect(200);
    const second = await support.agent
      .get('/api/v1/admin/users')
      .query({ page: 2, pageSize: 1, sort: 'name', direction: 'asc' })
      .expect(200);
    expect(first.body.total).toBe(4);
    expect(first.body.items[0].id).not.toBe(second.body.items[0].id);
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
    const rejected = response.body.items.find(
      (event: { action: string }) => event.action === 'AUTH_SIGNIN_FAILED',
    );
    expect(rejected).toMatchObject({
      summary: 'A sign-in attempt was rejected.',
    });
    expect(Object.keys(rejected).sort()).toEqual([
      'action',
      'id',
      'occurredAt',
      'summary',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('identityDigest');
    expect(JSON.stringify(response.body)).not.toContain('raw-json-secret');
    expect(JSON.stringify(response.body)).not.toContain('requestId');
  });

  it('requires exact Origin and CSRF evidence on mutations with no-store errors', async () => {
    const admin = await signUp('admin@example.com', 'Admin User');
    const target = await signUp('target@example.com', 'Target User');
    await setRole('admin@example.com', 'ADMIN');

    const missingOrigin = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrfToken)
      .send({ version: 0, role: 'SUPPORT' });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.headers['cache-control']).toBe('no-store');

    const missingCsrf = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Origin', appOrigin)
      .set('Cookie', admin.cookie)
      .send({ version: 0, role: 'SUPPORT' });
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.code).toBe('CSRF_VALIDATION_FAILED');
    expect(missingCsrf.headers['cache-control']).toBe('no-store');

    await patchUser(admin, target.user.id, {
      version: 0,
      role: 'SUPPORT',
    }).then((response) => expect(response.status).toBe(200));
  });

  it('serializes two concurrent active-admin removals and leaves one active admin', async () => {
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

    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(responses.filter((response) => response.status >= 400)).toHaveLength(
      1,
    );
    expect(
      await connection.collection('users').countDocuments({
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    ).toBe(1);
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
