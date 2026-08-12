import type { SafeUser } from '@easygenerator/contracts';
import type { ClientSession } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  AdminUserChanges,
  NewUser,
  StoredUser,
  StoredUserPage,
  StoredUserWithPassword,
  UsersRepository,
} from './users.repository';
import { UsersService } from './users.service';

const storedUser: StoredUser = {
  id: '507f1f77bcf86cd799439011',
  email: 'User+tag@example.com',
  emailKey: 'user+tag@example.com',
  name: 'Example User',
  role: 'USER',
  status: 'ACTIVE',
  version: 3,
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  updatedAt: new Date('2026-08-02T10:00:00.000Z'),
};

const expectedSafeUser: SafeUser = {
  id: storedUser.id,
  email: storedUser.email,
  name: storedUser.name,
  role: storedUser.role,
  status: storedUser.status,
  version: storedUser.version,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
};

class InMemoryUsersRepository {
  lastCreate: NewUser | undefined;
  lastCreateSession: ClientSession | undefined;
  lastAuthenticationKey: string | undefined;
  authenticationResult: StoredUserWithPassword | null = {
    ...storedUser,
    passwordHash: 'argon2-hash',
  };
  safeResult: StoredUser | null = storedUser;
  pageResult: StoredUserPage = {
    items: [storedUser],
    total: 1,
    summary: { total: 4, active: 3 },
  };
  lastLookupSession: ClientSession | undefined;
  lastUpdate:
    | {
        id: string;
        expectedVersion: number;
        changes: AdminUserChanges;
        dbSession: ClientSession;
      }
    | undefined;
  bootstrapConflictResult: 'ADMIN_EXISTS' | 'EMAIL_EXISTS' | null = null;
  lastBootstrapKey: string | undefined;
  lastBootstrapSession: ClientSession | undefined;

  create(user: NewUser, dbSession?: ClientSession): Promise<StoredUser> {
    this.lastCreate = { ...user };
    this.lastCreateSession = dbSession;
    return Promise.resolve(storedUser);
  }

  findForAuthentication(
    emailKey: string,
  ): Promise<StoredUserWithPassword | null> {
    this.lastAuthenticationKey = emailKey;
    return Promise.resolve(this.authenticationResult);
  }

  findSafeById(
    _id?: string,
    dbSession?: ClientSession,
  ): Promise<StoredUser | null> {
    this.lastLookupSession = dbSession;
    return Promise.resolve(this.safeResult);
  }

  findAdminPage(): Promise<StoredUserPage> {
    return Promise.resolve(this.pageResult);
  }

  updateAdminUser(
    id: string,
    expectedVersion: number,
    changes: AdminUserChanges,
    dbSession: ClientSession,
  ): Promise<Omit<StoredUser, 'emailKey'> | null> {
    this.lastUpdate = { id, expectedVersion, changes, dbSession };
    return Promise.resolve({
      ...storedUser,
      ...changes,
      version: expectedVersion + 1,
    });
  }

  bootstrapConflict(
    emailKey: string,
    dbSession: ClientSession,
  ): Promise<'ADMIN_EXISTS' | 'EMAIL_EXISTS' | null> {
    this.lastBootstrapKey = emailKey;
    this.lastBootstrapSession = dbSession;
    return Promise.resolve(this.bootstrapConflictResult);
  }
}

describe('UsersService', () => {
  let repository: InMemoryUsersRepository;
  let service: UsersService;

  beforeEach(() => {
    repository = new InMemoryUsersRepository();
    service = new UsersService(repository as unknown as UsersRepository);
  });

  it('creates a public user with exact email-key normalization and safe defaults', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;

    await expect(
      service.createUser(
        {
          email: ' User+tag@Example.com ',
          name: 'Example User',
          passwordHash: 'argon2-hash',
          role: 'USER',
          status: 'ACTIVE',
        },
        dbSession,
      ),
    ).resolves.toEqual(expectedSafeUser);
    expect(repository.lastCreate).toEqual({
      email: 'User+tag@Example.com',
      emailKey: 'user+tag@example.com',
      name: 'Example User',
      passwordHash: 'argon2-hash',
      role: 'USER',
      status: 'ACTIVE',
    });
    expect(repository.lastCreateSession).toBe(dbSession);
  });

  it('does not apply provider-specific plus or dot normalization', async () => {
    await service.createUser({
      email: ' First.Last+training@Gmail.com ',
      name: 'Example User',
      passwordHash: 'argon2-hash',
      role: 'USER',
      status: 'ACTIVE',
    });

    expect(repository.lastCreate?.emailKey).toBe(
      'first.last+training@gmail.com',
    );
  });

  it('exposes the password hash only through authentication lookup', async () => {
    await expect(
      service.findForAuthentication(' USER+tag@Example.com '),
    ).resolves.toEqual({
      user: expectedSafeUser,
      passwordHash: 'argon2-hash',
    });
    expect(repository.lastAuthenticationKey).toBe('user+tag@example.com');
  });

  it('maps safe lookups without password hashes or internal email keys', async () => {
    const mapped = await service.findSafeById(storedUser.id);

    expect(mapped).toEqual(expectedSafeUser);
    expect(mapped).not.toHaveProperty('passwordHash');
    expect(mapped).not.toHaveProperty('emailKey');
  });

  it('returns null when either lookup has no matching user', async () => {
    repository.authenticationResult = null;
    repository.safeResult = null;

    await expect(
      service.findForAuthentication('nobody@example.com'),
    ).resolves.toBeNull();
    await expect(service.findSafeById('missing')).resolves.toBeNull();
  });

  it('maps bounded admin pages without internal user fields', async () => {
    await expect(
      service.listAdminUsers({
        page: 1,
        pageSize: 20,
        sort: 'createdAt',
        direction: 'desc',
      }),
    ).resolves.toEqual({
      items: [expectedSafeUser],
      page: 1,
      pageSize: 20,
      total: 1,
      summary: { total: 4, active: 3 },
    });
  });

  it('forwards transaction-bound reads and versioned updates', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;

    await expect(
      service.findSafeById(storedUser.id, dbSession),
    ).resolves.toEqual(expectedSafeUser);
    expect(repository.lastLookupSession).toBe(dbSession);
    await expect(
      service.updateAdminUser(storedUser.id, 3, { role: 'SUPPORT' }, dbSession),
    ).resolves.toMatchObject({ role: 'SUPPORT', version: 4 });
    expect(repository.lastUpdate).toEqual({
      id: storedUser.id,
      expectedVersion: 3,
      changes: { role: 'SUPPORT' },
      dbSession,
    });
  });

  it('normalizes bootstrap checks and creates only an ACTIVE ADMIN', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;

    await expect(
      service.bootstrapConflict(' Admin@Example.com ', dbSession),
    ).resolves.toBeNull();
    expect(repository.lastBootstrapKey).toBe('admin@example.com');
    expect(repository.lastBootstrapSession).toBe(dbSession);
    await expect(
      service.createBootstrapAdmin(
        {
          email: ' Admin@Example.com ',
          name: 'Administrator',
          passwordHash: 'argon2-hash',
        },
        dbSession,
      ),
    ).resolves.toEqual(expectedSafeUser);
    expect(repository.lastCreate).toEqual({
      email: 'Admin@Example.com',
      emailKey: 'admin@example.com',
      name: 'Administrator',
      passwordHash: 'argon2-hash',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    expect(repository.lastCreateSession).toBe(dbSession);
  });
});
