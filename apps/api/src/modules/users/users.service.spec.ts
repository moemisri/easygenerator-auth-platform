import type { SafeUser } from '@easygenerator/contracts';
import type { ClientSession } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  NewUser,
  StoredUser,
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

  async create(user: NewUser, dbSession?: ClientSession): Promise<StoredUser> {
    this.lastCreate = { ...user };
    this.lastCreateSession = dbSession;
    return storedUser;
  }

  async findForAuthentication(
    emailKey: string,
  ): Promise<StoredUserWithPassword | null> {
    this.lastAuthenticationKey = emailKey;
    return this.authenticationResult;
  }

  async findSafeById(): Promise<StoredUser | null> {
    return this.safeResult;
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
});
