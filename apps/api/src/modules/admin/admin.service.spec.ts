import type { SafeUser } from '@easygenerator/contracts';
import type { ClientSession, Connection } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../audit/audit.service';
import type { SessionService } from '../auth/session.service';
import type { UsersService } from '../users/users.service';
import type { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';

const actor: SafeUser = {
  id: 'actor-id',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'ADMIN',
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

const target: SafeUser = {
  id: 'target-id',
  email: 'user@example.com',
  name: 'Basic User',
  role: 'USER',
  status: 'ACTIVE',
  version: 3,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

function sessionConnection() {
  let transactionOpen = false;
  const session = {
    abortTransaction: vi.fn(() => {
      transactionOpen = false;
      return Promise.resolve();
    }),
    commitTransaction: vi.fn(() => {
      transactionOpen = false;
      return Promise.resolve();
    }),
    endSession: vi.fn().mockResolvedValue(undefined),
    inTransaction: vi.fn(() => transactionOpen),
    startTransaction: vi.fn(() => {
      transactionOpen = true;
    }),
  };
  const dbSession = session as unknown as ClientSession;
  return {
    connection: {
      startSession: vi.fn().mockResolvedValue(dbSession),
    },
    dbSession,
    session,
  };
}

function dependencies() {
  const users = {
    findSafeById: vi.fn(
      (id: string, session?: ClientSession): Promise<SafeUser | null> => {
        void session;
        return Promise.resolve(
          id === actor.id ? actor : id === target.id ? target : null,
        );
      },
    ),
    listAdminUsers: vi.fn(),
    updateAdminUser: vi.fn(
      (
        _id: string,
        expectedVersion: number,
        changes: Partial<Pick<SafeUser, 'role' | 'status'>>,
      ): Promise<SafeUser | null> =>
        Promise.resolve({
          ...target,
          ...changes,
          version: expectedVersion + 1,
          updatedAt: '2026-08-02T10:00:00.000Z',
        }),
    ),
  };
  const sessions = { revokeAllForUser: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const adminRepository = {
    incrementSecurityRevision: vi.fn().mockResolvedValue(undefined),
  };
  const { connection, dbSession, session } = sessionConnection();
  const service = new AdminService(
    users as unknown as UsersService,
    sessions as unknown as SessionService,
    audit as unknown as AuditService,
    adminRepository as unknown as AdminRepository,
    connection as unknown as Connection,
  );
  return {
    adminRepository,
    audit,
    connection,
    dbSession,
    service,
    session,
    sessions,
    users,
  };
}

describe('AdminService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('rechecks policy and atomically updates, revokes sessions, and audits each changed field', async () => {
    const {
      adminRepository,
      audit,
      dbSession,
      service,
      session,
      sessions,
      users,
    } = dependencies();

    await expect(
      service.updateUser(
        actor,
        target.id,
        { version: 3, role: 'SUPPORT', status: 'DISABLED' },
        { requestId: 'request-id' },
      ),
    ).resolves.toMatchObject({
      id: target.id,
      role: 'SUPPORT',
      status: 'DISABLED',
      version: 4,
    });

    expect(users.findSafeById).toHaveBeenCalledWith(actor.id, dbSession);
    expect(users.findSafeById).toHaveBeenCalledWith(target.id, dbSession);
    expect(
      users.findSafeById.mock.calls.every((call) => call[1] === dbSession),
    ).toBe(true);
    expect(users.updateAdminUser).toHaveBeenCalledWith(
      target.id,
      3,
      { role: 'SUPPORT', status: 'DISABLED' },
      dbSession,
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      target.id,
      dbSession,
    );
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenNthCalledWith(
      1,
      {
        action: 'USER_ROLE_CHANGED',
        actorId: actor.id,
        targetId: target.id,
        from: 'USER',
        to: 'SUPPORT',
        requestId: 'request-id',
      },
      dbSession,
    );
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      {
        action: 'USER_STATUS_CHANGED',
        actorId: actor.id,
        targetId: target.id,
        from: 'ACTIVE',
        to: 'DISABLED',
        requestId: 'request-id',
      },
      dbSession,
    );
    expect(adminRepository.incrementSecurityRevision).toHaveBeenCalledWith(
      dbSession,
    );
    expect(session.startTransaction).toHaveBeenCalledOnce();
    expect(session.commitTransaction).toHaveBeenCalledOnce();
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('uses the transaction copy of the actor and fails closed after a role change', async () => {
    const { service, users } = dependencies();
    users.findSafeById.mockImplementation((id, session) => {
      if (id === actor.id && session !== undefined) {
        return Promise.resolve({ ...actor, role: 'MANAGER' });
      }
      if (id === target.id)
        return Promise.resolve({ ...target, role: 'ADMIN' });
      return Promise.resolve(null);
    });

    await expect(
      service.updateUser(
        actor,
        target.id,
        { version: 3, role: 'USER' },
        { requestId: 'request-id' },
      ),
    ).rejects.toMatchObject({
      code: 'TARGET_UPDATE_FORBIDDEN',
      status: 403,
    });
  });

  it('acquires the shared security revision before rereading a target that changed to ADMIN', async () => {
    const { adminRepository, service, users } = dependencies();
    const sequence: string[] = [];
    adminRepository.incrementSecurityRevision.mockImplementation(() => {
      sequence.push('security');
      return Promise.resolve();
    });
    users.findSafeById.mockImplementation((id, session) => {
      if (session !== undefined) sequence.push(`read:${id}`);
      return Promise.resolve(
        id === actor.id ? actor : { ...target, role: 'ADMIN' },
      );
    });

    await service.updateUser(
      actor,
      target.id,
      { version: 3, role: 'SUPPORT' },
      { requestId: 'request-id' },
    );

    expect(sequence[0]).toBe('security');
    expect(sequence).toEqual([
      'security',
      `read:${actor.id}`,
      `read:${target.id}`,
    ]);
  });

  it('runs actor and target reads sequentially on the transaction session', async () => {
    const { dbSession, service, users } = dependencies();
    let releaseActor: ((user: SafeUser) => void) | undefined;
    users.findSafeById.mockImplementation((id) => {
      if (id === actor.id) {
        return new Promise<SafeUser>((resolve) => {
          releaseActor = resolve;
        });
      }
      return Promise.resolve(target);
    });

    const update = service.updateUser(
      actor,
      target.id,
      { version: 3, role: 'SUPPORT' },
      { requestId: 'request-id' },
    );
    await vi.waitFor(() => {
      expect(users.findSafeById).toHaveBeenCalledTimes(1);
      expect(users.findSafeById).toHaveBeenCalledWith(actor.id, dbSession);
    });
    expect(releaseActor).toBeTypeOf('function');
    releaseActor?.(actor);
    await update;

    expect(users.findSafeById).toHaveBeenNthCalledWith(2, target.id, dbSession);
  });

  it('rejects missing targets, stale versions, and loaded no-ops before writes', async () => {
    const missing = dependencies();
    missing.users.findSafeById.mockImplementation((id) =>
      Promise.resolve(id === actor.id ? actor : null),
    );
    await expect(
      missing.service.updateUser(
        actor,
        target.id,
        { version: 3, role: 'SUPPORT' },
        { requestId: 'request-id' },
      ),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', status: 404 });

    const stale = dependencies();
    await expect(
      stale.service.updateUser(
        actor,
        target.id,
        { version: 2, role: 'SUPPORT' },
        { requestId: 'request-id' },
      ),
    ).rejects.toMatchObject({ code: 'STALE_USER_VERSION', status: 409 });
    expect(stale.users.updateAdminUser).not.toHaveBeenCalled();

    const noOp = dependencies();
    await expect(
      noOp.service.updateUser(
        actor,
        target.id,
        { version: 3, role: 'USER' },
        { requestId: 'request-id' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(noOp.users.updateAdminUser).not.toHaveBeenCalled();
  });

  it('rejects an actor that is no longer active inside the transaction', async () => {
    const { service, users } = dependencies();
    users.findSafeById.mockImplementation((id, session) => {
      if (id === actor.id && session !== undefined) {
        return Promise.resolve({ ...actor, status: 'DISABLED' });
      }
      return Promise.resolve(target);
    });

    await expect(
      service.updateUser(
        actor,
        target.id,
        { version: 3, role: 'SUPPORT' },
        { requestId: 'request-id' },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });

  it('serializes cross-admin removal without an unreachable active-admin count', async () => {
    const { adminRepository, dbSession, service, users } = dependencies();
    users.findSafeById.mockImplementation((id) =>
      Promise.resolve(
        id === actor.id
          ? actor
          : { ...target, role: 'ADMIN', status: 'ACTIVE' },
      ),
    );
    await expect(
      service.updateUser(
        actor,
        target.id,
        { version: 3, status: 'DISABLED' },
        { requestId: 'request-id' },
      ),
    ).resolves.toMatchObject({ status: 'DISABLED' });
    expect(adminRepository.incrementSecurityRevision).toHaveBeenCalledWith(
      dbSession,
    );
    expect(users.updateAdminUser).toHaveBeenCalledOnce();
  });

  it('serializes promotion into ADMIN membership', async () => {
    const { adminRepository, dbSession, service } = dependencies();

    await service.updateUser(
      actor,
      target.id,
      { version: 3, role: 'ADMIN' },
      { requestId: 'request-id' },
    );

    expect(adminRepository.incrementSecurityRevision).toHaveBeenCalledWith(
      dbSession,
    );
  });

  it('maps a raced versioned write to STALE_USER_VERSION without side effects', async () => {
    const { audit, service, sessions, users } = dependencies();
    users.updateAdminUser.mockResolvedValue(null);

    await expect(
      service.updateUser(
        actor,
        target.id,
        { version: 3, role: 'SUPPORT' },
        { requestId: 'request-id' },
      ),
    ).rejects.toMatchObject({ code: 'STALE_USER_VERSION', status: 409 });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('retries only labeled Mongo transaction conflicts and stops at three attempts', async () => {
    const retrying = dependencies();
    const labeledError = {
      hasErrorLabel: (label: string) => label === 'TransientTransactionError',
    };
    retrying.adminRepository.incrementSecurityRevision
      .mockRejectedValueOnce(labeledError)
      .mockRejectedValueOnce(labeledError);

    await retrying.service.updateUser(
      actor,
      target.id,
      { version: 3, role: 'SUPPORT' },
      { requestId: 'request-id' },
    );
    expect(
      retrying.adminRepository.incrementSecurityRevision,
    ).toHaveBeenCalledTimes(3);
    expect(retrying.session.startTransaction).toHaveBeenCalledTimes(3);
    expect(retrying.session.abortTransaction).toHaveBeenCalledTimes(2);
    expect(retrying.session.commitTransaction).toHaveBeenCalledOnce();
    expect(retrying.session.endSession).toHaveBeenCalledOnce();

    const exhausted = dependencies();
    exhausted.adminRepository.incrementSecurityRevision.mockRejectedValue(
      labeledError,
    );
    await expect(
      exhausted.service.updateUser(
        actor,
        target.id,
        { version: 3, role: 'SUPPORT' },
        { requestId: 'request-id' },
      ),
    ).rejects.toMatchObject({ code: 'ADMIN_UPDATE_CONFLICT', status: 409 });
    expect(exhausted.session.startTransaction).toHaveBeenCalledTimes(3);
    expect(exhausted.session.abortTransaction).toHaveBeenCalledTimes(3);
    expect(exhausted.session.commitTransaction).not.toHaveBeenCalled();
    expect(exhausted.session.endSession).toHaveBeenCalledOnce();

    const ordinary = dependencies();
    const ordinaryError = new Error('audit persistence failed');
    ordinary.audit.record.mockRejectedValue(ordinaryError);
    await expect(
      ordinary.service.updateUser(
        actor,
        target.id,
        { version: 3, role: 'SUPPORT' },
        { requestId: 'request-id' },
      ),
    ).rejects.toBe(ordinaryError);
    expect(ordinary.session.startTransaction).toHaveBeenCalledOnce();
    expect(ordinary.session.abortTransaction).toHaveBeenCalledOnce();
    expect(ordinary.session.commitTransaction).not.toHaveBeenCalled();
    expect(ordinary.session.endSession).toHaveBeenCalledOnce();
  });

  it('retries an unknown commit result without rerunning the transaction body', async () => {
    const uncertain = dependencies();
    const unknownCommit = {
      hasErrorLabel: (label: string) =>
        label === 'UnknownTransactionCommitResult',
    };
    uncertain.session.commitTransaction
      .mockRejectedValueOnce(unknownCommit)
      .mockResolvedValueOnce(undefined);

    await uncertain.service.updateUser(
      actor,
      target.id,
      { version: 3, role: 'SUPPORT' },
      { requestId: 'request-id' },
    );

    expect(uncertain.users.updateAdminUser).toHaveBeenCalledOnce();
    expect(uncertain.sessions.revokeAllForUser).toHaveBeenCalledOnce();
    expect(uncertain.audit.record).toHaveBeenCalledOnce();
    expect(uncertain.session.startTransaction).toHaveBeenCalledOnce();
    expect(uncertain.session.commitTransaction).toHaveBeenCalledTimes(2);
    expect(uncertain.session.endSession).toHaveBeenCalledOnce();

    const exhausted = dependencies();
    exhausted.session.commitTransaction.mockRejectedValue(unknownCommit);
    await expect(
      exhausted.service.updateUser(
        actor,
        target.id,
        { version: 3, role: 'SUPPORT' },
        { requestId: 'request-id' },
      ),
    ).rejects.toMatchObject({ code: 'ADMIN_UPDATE_CONFLICT', status: 409 });
    expect(exhausted.users.updateAdminUser).toHaveBeenCalledOnce();
    expect(exhausted.session.startTransaction).toHaveBeenCalledOnce();
    expect(exhausted.session.commitTransaction).toHaveBeenCalledTimes(3);
    expect(exhausted.session.endSession).toHaveBeenCalledOnce();
  });
});
