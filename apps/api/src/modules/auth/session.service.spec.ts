import { createHash } from 'node:crypto';

import type { SafeUser } from '@easygenerator/contracts';
import type { ClientSession } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  NewSession,
  SessionRepository,
  StoredSession,
} from './session.repository';
import {
  SessionService,
  type Clock,
  type RandomSource,
} from './session.service';
import type { UsersService } from '../users/users.service';

const DAY_MS = 24 * 60 * 60 * 1_000;
const initialTime = new Date('2026-08-11T10:00:00.000Z');
const userId = '507f1f77bcf86cd799439011';
const fixedRandomBytes = Buffer.alloc(32, 0xab);
const rawTokenFixture = fixedRandomBytes.toString('base64url');
const tokenDigestFixture = createHash('sha256')
  .update(rawTokenFixture)
  .digest('hex');

const activeUser: SafeUser = {
  id: userId,
  email: 'User+tag@example.com',
  name: 'Example User',
  role: 'USER',
  status: 'ACTIVE',
  version: 0,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advanceByMilliseconds(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class FixedRandomSource implements RandomSource {
  requestedBytes: number[] = [];

  bytes(size: number): Buffer {
    this.requestedBytes.push(size);
    return fixedRandomBytes;
  }
}

class InMemorySessionRepository {
  records = new Map<string, StoredSession>();
  lastLookupDigest: string | undefined;
  lastWrite: NewSession | undefined;
  lastCreateSession: ClientSession | undefined;
  lastRevokeSession: ClientSession | undefined;
  lastRevokeAllSession: ClientSession | undefined;

  async create(
    session: NewSession,
    dbSession?: ClientSession,
  ): Promise<StoredSession> {
    this.lastWrite = { ...session };
    this.lastCreateSession = dbSession;
    const stored: StoredSession = {
      id: 'session-id',
      ...session,
      revokedAt: null,
    };
    this.records.set(session.tokenDigest, stored);
    return stored;
  }

  async findByTokenDigest(tokenDigest: string): Promise<StoredSession | null> {
    this.lastLookupDigest = tokenDigest;
    return this.records.get(tokenDigest) ?? null;
  }

  async revokeByTokenDigest(
    tokenDigest: string,
    revokedAt: Date,
    dbSession?: ClientSession,
  ): Promise<void> {
    this.lastRevokeSession = dbSession;
    const session = this.records.get(tokenDigest);
    if (session !== undefined) {
      this.records.set(tokenDigest, { ...session, revokedAt });
    }
  }

  async revokeAllForUser(
    revokedUserId: string,
    revokedAt: Date,
    dbSession?: ClientSession,
  ): Promise<void> {
    this.lastRevokeAllSession = dbSession;
    for (const [digest, session] of this.records) {
      if (session.userId === revokedUserId) {
        this.records.set(digest, { ...session, revokedAt });
      }
    }
  }
}

describe('SessionService', () => {
  let clock: MutableClock;
  let random: FixedRandomSource;
  let repository: InMemorySessionRepository;
  let currentUser: SafeUser | null;
  let service: SessionService;

  beforeEach(() => {
    clock = new MutableClock(initialTime);
    random = new FixedRandomSource();
    repository = new InMemorySessionRepository();
    currentUser = activeUser;
    const users = {
      findSafeById: async () => currentUser,
    } as unknown as UsersService;
    service = new SessionService(
      repository as unknown as SessionRepository,
      users,
      clock,
      random,
    );
  });

  it('persists only a SHA-256 digest of a 32-byte random token', async () => {
    const created = await service.create(userId);

    expect(created).toEqual({
      rawToken: rawTokenFixture,
      expiresAt: new Date(initialTime.getTime() + 7 * DAY_MS),
    });
    expect(random.requestedBytes).toEqual([32]);
    expect(repository.lastWrite).toEqual({
      userId,
      tokenDigest: tokenDigestFixture,
      expiresAt: new Date(initialTime.getTime() + 7 * DAY_MS),
    });
    expect(repository.lastWrite).not.toHaveProperty('rawToken');
    expect(JSON.stringify(repository.lastWrite)).not.toContain(rawTokenFixture);
  });

  it('resolves by digest and loads the current safe user', async () => {
    await service.create(userId);

    await expect(service.resolve(rawTokenFixture)).resolves.toEqual({
      sessionId: 'session-id',
      user: activeUser,
    });
    expect(repository.lastLookupDigest).toBe(tokenDigestFixture);
  });

  it('rejects a session at the exact absolute-expiry boundary', async () => {
    await service.create(userId);
    clock.advanceByMilliseconds(7 * DAY_MS);

    await expect(service.resolve(rawTokenFixture)).resolves.toBeNull();
  });

  it('rejects a revoked session', async () => {
    await service.create(userId);
    await service.revoke(rawTokenFixture);

    await expect(service.resolve(rawTokenFixture)).resolves.toBeNull();
  });

  it('rejects a session whose user no longer exists', async () => {
    await service.create(userId);
    currentUser = null;

    await expect(service.resolve(rawTokenFixture)).resolves.toBeNull();
  });

  it('rejects a session whose current user is disabled', async () => {
    await service.create(userId);
    currentUser = { ...activeUser, status: 'DISABLED' };

    await expect(service.resolve(rawTokenFixture)).resolves.toBeNull();
  });

  it('returns null when no session matches the digest', async () => {
    await expect(service.resolve(rawTokenFixture)).resolves.toBeNull();
    expect(repository.lastLookupDigest).toBe(tokenDigestFixture);
  });

  it('forwards database sessions for transactional writes', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;

    await service.create(userId, dbSession);
    await service.revoke(rawTokenFixture, dbSession);
    await service.revokeAllForUser(userId, dbSession);

    expect(repository.lastCreateSession).toBe(dbSession);
    expect(repository.lastRevokeSession).toBe(dbSession);
    expect(repository.lastRevokeAllSession).toBe(dbSession);
  });
});
