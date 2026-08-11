import type { SafeUser } from '@easygenerator/contracts';
import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';

import {
  type NewUser,
  type StoredUser,
  UsersRepository,
} from './users.repository';

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
}

export interface AuthenticationUser {
  user: SafeUser;
  passwordHash: string;
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

function safeUser(user: StoredUser): SafeUser {
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

  async findSafeById(id: string): Promise<SafeUser | null> {
    const user = await this.users.findSafeById(id);
    return user === null ? null : safeUser(user);
  }
}
