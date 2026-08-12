import type {
  AdminUsersQuery,
  SafeUser,
  UserPage,
} from '@easygenerator/contracts';
import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';

import {
  type AdminUserChanges,
  type BootstrapConflict,
  type NewUser,
  type StoredSafeUser,
  type StoredUser,
  UsersRepository,
} from './users.repository.js';

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
  role: 'USER';
  status: 'ACTIVE';
}

export interface AuthenticationUser {
  user: SafeUser;
  passwordHash: string;
}

export interface CreateBootstrapAdminInput {
  email: string;
  name: string;
  passwordHash: string;
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

function safeUser(user: StoredUser | StoredSafeUser): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    version: user.version,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async createUser(
    input: CreateUserInput,
    dbSession?: ClientSession,
  ): Promise<SafeUser> {
    const email = input.email.trim();
    const user: NewUser = {
      email,
      emailKey: emailKey(input.email),
      name: input.name,
      passwordHash: input.passwordHash,
      role: 'USER',
      status: 'ACTIVE',
    };
    return safeUser(await this.users.create(user, dbSession));
  }

  async findForAuthentication(
    identity: string,
  ): Promise<AuthenticationUser | null> {
    const user = await this.users.findForAuthentication(emailKey(identity));
    return user === null
      ? null
      : { user: safeUser(user), passwordHash: user.passwordHash };
  }

  async findSafeById(
    id: string,
    dbSession?: ClientSession,
  ): Promise<SafeUser | null> {
    const user = await this.users.findSafeById(id, dbSession);
    return user === null ? null : safeUser(user);
  }

  async listAdminUsers(query: AdminUsersQuery): Promise<UserPage> {
    const page = await this.users.findAdminPage(query);
    return {
      items: page.items.map(safeUser),
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      summary: page.summary,
    };
  }

  async updateAdminUser(
    id: string,
    expectedVersion: number,
    changes: AdminUserChanges,
    dbSession: ClientSession,
  ): Promise<SafeUser | null> {
    const user = await this.users.updateAdminUser(
      id,
      expectedVersion,
      changes,
      dbSession,
    );
    return user === null ? null : safeUser(user);
  }

  async countActiveAdmins(dbSession: ClientSession): Promise<number> {
    return this.users.countActiveAdmins(dbSession);
  }

  async bootstrapConflict(
    email: string,
    dbSession: ClientSession,
  ): Promise<BootstrapConflict | null> {
    return this.users.bootstrapConflict(emailKey(email), dbSession);
  }

  async createBootstrapAdmin(
    input: CreateBootstrapAdminInput,
    dbSession: ClientSession,
  ): Promise<SafeUser> {
    const email = input.email.trim();
    return safeUser(
      await this.users.create(
        {
          email,
          emailKey: emailKey(email),
          name: input.name,
          passwordHash: input.passwordHash,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
        dbSession,
      ),
    );
  }
}
