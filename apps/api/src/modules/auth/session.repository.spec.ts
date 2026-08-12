import type { ClientSession, Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import type { Session } from './schemas/session.schema';
import { SessionRepository, type NewSession } from './session.repository';

const newSession: NewSession = {
  userId: '507f1f77bcf86cd799439011',
  tokenDigest: 'a'.repeat(64),
  expiresAt: new Date('2026-08-18T10:00:00.000Z'),
};

describe('SessionRepository', () => {
  it('persists the digest and forwards the database session', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;
    const stored = { _id: 'session-id', ...newSession, revokedAt: null };
    const create = vi.fn().mockResolvedValue([{ toObject: () => stored }]);
    const repository = new SessionRepository({
      create,
    } as unknown as Model<Session>);

    await expect(repository.create(newSession, dbSession)).resolves.toEqual({
      id: 'session-id',
      ...newSession,
      revokedAt: null,
    });
    expect(create).toHaveBeenCalledWith([newSession], { session: dbSession });
    expect(JSON.stringify(create.mock.calls)).not.toContain('rawToken');
  });

  it('looks sessions up only by digest', async () => {
    const stored = { _id: 'session-id', ...newSession, revokedAt: null };
    const exec = vi.fn().mockResolvedValue(stored);
    const lean = vi.fn(() => ({ exec }));
    const findOne = vi.fn(() => ({ lean }));
    const repository = new SessionRepository({
      findOne,
    } as unknown as Model<Session>);

    await expect(
      repository.findByTokenDigest(newSession.tokenDigest),
    ).resolves.toMatchObject({ id: 'session-id' });
    expect(findOne).toHaveBeenCalledWith({
      tokenDigest: newSession.tokenDigest,
    });
  });

  it('forwards database sessions when revoking one or all user sessions', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;
    const execOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const execMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    const updateOne = vi.fn(() => ({ exec: execOne }));
    const updateMany = vi.fn(() => ({ exec: execMany }));
    const repository = new SessionRepository({
      updateOne,
      updateMany,
    } as unknown as Model<Session>);
    const revokedAt = new Date('2026-08-11T10:00:00.000Z');

    await repository.revokeByTokenDigest(
      newSession.tokenDigest,
      revokedAt,
      dbSession,
    );
    await repository.revokeAllForUser(newSession.userId, revokedAt, dbSession);

    expect(updateOne).toHaveBeenCalledWith(
      { tokenDigest: newSession.tokenDigest },
      { $set: { revokedAt } },
      { session: dbSession },
    );
    expect(updateMany).toHaveBeenCalledWith(
      { userId: newSession.userId, revokedAt: null },
      { $set: { revokedAt } },
      { session: dbSession },
    );
  });
});
