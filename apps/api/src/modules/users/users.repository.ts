import type { Role, UserStatus } from '@easygenerator/contracts';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import { User } from './schemas/user.schema';

export interface NewUser {
  email: string;
  emailKey: string;
  name: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
}

export interface StoredUser {
  id: string;
  email: string;
  emailKey: string;
  name: string;
  role: Role;
  status: UserStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredUserWithPassword extends StoredUser {
  passwordHash: string;
}

interface UserRecord extends Omit<StoredUser, 'id'> {
  _id: unknown;
  passwordHash?: string;
}

function mapStoredUser(user: UserRecord): StoredUser {
  return {
    id: String(user._id),
    email: user.email,
    emailKey: user.emailKey,
    name: user.name,
    role: user.role,
    status: user.status,
    version: user.version,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async create(user: NewUser, dbSession?: ClientSession): Promise<StoredUser> {
    const documents =
      dbSession === undefined
        ? await this.users.create([user])
        : await this.users.create([user], { session: dbSession });
    const document = documents[0];
    if (document === undefined) {
      throw new Error('User creation returned no document');
    }
    return mapStoredUser(document.toObject() as UserRecord);
  }

  async findForAuthentication(
    emailKey: string,
  ): Promise<StoredUserWithPassword | null> {
    const user = await this.users
      .findOne({ emailKey })
      .select('+passwordHash')
      .lean<UserRecord>()
      .exec();
    if (user === null || user.passwordHash === undefined) return null;
    return { ...mapStoredUser(user), passwordHash: user.passwordHash };
  }

  async findSafeById(id: string): Promise<StoredUser | null> {
    const user = await this.users.findById(id).lean<UserRecord>().exec();
    return user === null ? null : mapStoredUser(user);
  }
}
