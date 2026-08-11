import type {
  AdminUsersQuery,
  Role,
  UserStatus,
} from '@easygenerator/contracts';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, QueryFilter, SortOrder } from 'mongoose';

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

export type StoredSafeUser = Omit<StoredUser, 'emailKey'>;

export interface StoredUserPage {
  items: StoredSafeUser[];
  total: number;
  summary: { total: number; active: number };
}

export interface AdminUserChanges {
  role?: Role;
  status?: UserStatus;
}

export type BootstrapConflict = 'ADMIN_EXISTS' | 'EMAIL_EXISTS';

interface UserRecord extends Omit<StoredUser, 'id'> {
  _id: unknown;
  passwordHash?: string;
}

type SafeUserRecord = Omit<UserRecord, 'emailKey' | 'passwordHash'>;

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

function mapStoredSafeUser(user: SafeUserRecord): StoredSafeUser {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    version: user.version,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  async findSafeById(
    id: string,
    dbSession?: ClientSession,
  ): Promise<StoredUser | null> {
    const query = this.users.findById(id);
    const scopedQuery =
      dbSession === undefined ? query : query.session(dbSession);
    const user = await scopedQuery.lean<UserRecord>().exec();
    return user === null ? null : mapStoredUser(user);
  }

  async findAdminPage(query: AdminUsersQuery): Promise<StoredUserPage> {
    const search = query.search;
    const filter: QueryFilter<User> =
      search === undefined || search === ''
        ? {}
        : {
            $or: [
              { email: new RegExp(escapeRegex(search), 'i') },
              { name: new RegExp(escapeRegex(search), 'i') },
            ],
          };
    const direction: SortOrder = query.direction === 'asc' ? 1 : -1;
    const sort: Record<string, SortOrder> = {
      [query.sort]: direction,
      _id: direction,
    };
    const [users, total, summaryTotal, active] = await Promise.all([
      this.users
        .find(filter)
        .select('_id email name role status version createdAt updatedAt')
        .sort(sort)
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<SafeUserRecord[]>()
        .exec(),
      this.users.countDocuments(filter).exec(),
      this.users.countDocuments({}).exec(),
      this.users.countDocuments({ status: 'ACTIVE' }).exec(),
    ]);
    return {
      items: users.map(mapStoredSafeUser),
      total,
      summary: { total: summaryTotal, active },
    };
  }

  async updateAdminUser(
    id: string,
    expectedVersion: number,
    changes: AdminUserChanges,
    dbSession: ClientSession,
  ): Promise<StoredSafeUser | null> {
    const user = await this.users
      .findOneAndUpdate(
        { _id: id, version: expectedVersion },
        { $inc: { version: 1 }, $set: changes },
        { returnDocument: 'after', runValidators: true, session: dbSession },
      )
      .lean<SafeUserRecord>()
      .exec();
    return user === null ? null : mapStoredSafeUser(user);
  }

  async countActiveAdmins(dbSession: ClientSession): Promise<number> {
    return this.users
      .countDocuments({ role: 'ADMIN', status: 'ACTIVE' })
      .session(dbSession)
      .exec();
  }

  async bootstrapConflict(
    emailKey: string,
    dbSession: ClientSession,
  ): Promise<BootstrapConflict | null> {
    const admin = await this.users
      .exists({ role: 'ADMIN' })
      .session(dbSession)
      .exec();
    if (admin !== null) return 'ADMIN_EXISTS';
    const email = await this.users
      .exists({ emailKey })
      .session(dbSession)
      .exec();
    return email === null ? null : 'EMAIL_EXISTS';
  }
}
