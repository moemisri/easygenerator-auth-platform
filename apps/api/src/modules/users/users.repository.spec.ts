import type { ClientSession, Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import type { User } from './schemas/user.schema';
import { UsersRepository, type NewUser } from './users.repository';

const newUser: NewUser = {
  email: 'user@example.com',
  emailKey: 'user@example.com',
  name: 'Example User',
  passwordHash: 'argon2-hash',
  role: 'USER',
  status: 'ACTIVE',
};

function queryReturning(value: unknown) {
  const exec = vi.fn().mockResolvedValue(value);
  const lean = vi.fn(() => ({ exec }));
  const select = vi.fn(() => ({ lean }));
  return { exec, lean, select };
}

function adminListQueryReturning(value: unknown) {
  const exec = vi.fn().mockResolvedValue(value);
  const lean = vi.fn(() => ({ exec }));
  const limit = vi.fn(() => ({ lean }));
  const skip = vi.fn(() => ({ limit }));
  const sort = vi.fn(() => ({ skip }));
  const select = vi.fn(() => ({ sort }));
  return { exec, lean, limit, select, skip, sort };
}

describe('UsersRepository', () => {
  it('forwards a database session when creating a user', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;
    const stored = { _id: 'user-id', ...newUser };
    const create = vi.fn().mockResolvedValue([{ toObject: () => stored }]);
    const repository = new UsersRepository({
      create,
    } as unknown as Model<User>);

    await expect(repository.create(newUser, dbSession)).resolves.toMatchObject({
      id: 'user-id',
      emailKey: 'user@example.com',
    });
    expect(create).toHaveBeenCalledWith([newUser], { session: dbSession });
  });

  it('explicitly selects the password hash only for authentication', async () => {
    const stored = { _id: 'user-id', ...newUser };
    const query = queryReturning(stored);
    const findOne = vi.fn(() => ({ select: query.select }));
    const repository = new UsersRepository({
      findOne,
    } as unknown as Model<User>);

    await expect(
      repository.findForAuthentication('user@example.com'),
    ).resolves.toMatchObject({ id: 'user-id', passwordHash: 'argon2-hash' });
    expect(findOne).toHaveBeenCalledWith({ emailKey: 'user@example.com' });
    expect(query.select).toHaveBeenCalledWith('+passwordHash');
  });

  it('uses the default password-safe projection for id lookup', async () => {
    const stored = { _id: 'user-id', ...newUser };
    const query = queryReturning(stored);
    const findById = vi.fn(() => ({ lean: query.lean }));
    const repository = new UsersRepository({
      findById,
    } as unknown as Model<User>);

    const user = await repository.findSafeById('user-id');

    expect(findById).toHaveBeenCalledWith('user-id');
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).toHaveProperty('emailKey', 'user@example.com');
  });

  it('re-reads a user in the supplied transaction', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;
    const stored = { _id: 'user-id', ...newUser };
    const exec = vi.fn().mockResolvedValue(stored);
    const lean = vi.fn(() => ({ exec }));
    const session = vi.fn(() => ({ lean }));
    const findById = vi.fn(() => ({ session }));
    const repository = new UsersRepository({
      findById,
    } as unknown as Model<User>);

    await expect(
      repository.findSafeById('user-id', dbSession),
    ).resolves.toMatchObject({ id: 'user-id' });
    expect(session).toHaveBeenCalledWith(dbSession);
  });

  it('escapes literal search and appends _id to the allowlisted stable sort', async () => {
    const stored = {
      _id: 'user-id',
      ...newUser,
      version: 0,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    };
    const query = adminListQueryReturning([stored]);
    const find = vi.fn((filter: unknown) => {
      void filter;
      return { select: query.select };
    });
    const countDocuments = vi
      .fn()
      .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(1) })
      .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(6) });
    const estimatedDocumentCount = vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(8),
    }));
    const repository = new UsersRepository({
      countDocuments,
      estimatedDocumentCount,
      find,
    } as unknown as Model<User>);

    await expect(
      repository.findAdminPage({
        page: 2,
        pageSize: 3,
        search: 'Ada.*',
        sort: 'name',
        direction: 'asc',
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'user-id' }],
      total: 1,
      summary: { total: 8, active: 6 },
    });

    const filter = find.mock.calls[0]?.[0] as {
      $or: Array<Record<'email' | 'name', RegExp>>;
    };
    const emailPattern = filter.$or[0]?.email;
    const namePattern = filter.$or[1]?.name;
    expect(emailPattern).toBeInstanceOf(RegExp);
    expect(namePattern).toBeInstanceOf(RegExp);
    expect(emailPattern?.test('user+ada.*@example.com')).toBe(true);
    expect(emailPattern?.test('user+adax@example.com')).toBe(false);
    expect(namePattern?.test('Ada.* Lovelace')).toBe(true);
    expect(query.select).toHaveBeenCalledWith(
      '_id email name role status version createdAt updatedAt',
    );
    expect(query.sort).toHaveBeenCalledWith({ name: 1, _id: 1 });
    expect(query.skip).toHaveBeenCalledWith(3);
    expect(query.limit).toHaveBeenCalledWith(3);
    expect(estimatedDocumentCount).toHaveBeenCalledOnce();
    expect(countDocuments).toHaveBeenNthCalledWith(2, { status: 'ACTIVE' });
  });

  it('uses versioned updates and the transaction session atomically', async () => {
    const dbSession = { id: 'transaction' } as unknown as ClientSession;
    const stored = {
      _id: 'user-id',
      ...newUser,
      role: 'SUPPORT' as const,
      version: 4,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      updatedAt: new Date('2026-08-02T10:00:00.000Z'),
    };
    const lean = vi.fn(() => ({ exec: vi.fn().mockResolvedValue(stored) }));
    const findOneAndUpdate = vi.fn(() => ({ lean }));
    const repository = new UsersRepository({
      findOneAndUpdate,
    } as unknown as Model<User>);

    await expect(
      repository.updateAdminUser('user-id', 3, { role: 'SUPPORT' }, dbSession),
    ).resolves.toMatchObject({ id: 'user-id', role: 'SUPPORT', version: 4 });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'user-id', version: 3 },
      { $inc: { version: 1 }, $set: { role: 'SUPPORT' } },
      { returnDocument: 'after', runValidators: true, session: dbSession },
    );
  });

  it.each([
    [true, false, 'ADMIN_EXISTS'],
    [false, true, 'EMAIL_EXISTS'],
    [false, false, null],
  ] as const)(
    'detects serialized bootstrap conflicts admin=%s email=%s',
    async (adminExists, emailExists, expected) => {
      const dbSession = { id: 'transaction' } as unknown as ClientSession;
      const firstExec = vi
        .fn()
        .mockResolvedValue(adminExists ? { _id: 'admin-id' } : null);
      const secondExec = vi
        .fn()
        .mockResolvedValue(emailExists ? { _id: 'email-id' } : null);
      const session = vi
        .fn()
        .mockReturnValueOnce({ exec: firstExec })
        .mockReturnValueOnce({ exec: secondExec });
      const exists = vi.fn(() => ({ session }));
      const repository = new UsersRepository({
        exists,
      } as unknown as Model<User>);

      await expect(
        repository.bootstrapConflict('admin@example.com', dbSession),
      ).resolves.toBe(expected);
      expect(exists.mock.calls).toEqual(
        adminExists
          ? [[{ role: 'ADMIN' }]]
          : [[{ role: 'ADMIN' }], [{ emailKey: 'admin@example.com' }]],
      );
    },
  );
});
