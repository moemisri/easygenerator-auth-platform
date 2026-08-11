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
});
