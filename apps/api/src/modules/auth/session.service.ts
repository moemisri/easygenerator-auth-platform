import { createHash, randomBytes } from 'node:crypto';

import type { SafeUser } from '@easygenerator/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';

import { UsersService } from '../users/users.service';
import { SessionRepository } from './session.repository';

const SESSION_TOKEN_BYTES = 32;
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export const AUTH_CLOCK = Symbol('AUTH_CLOCK');
export const SESSION_RANDOM_SOURCE = Symbol('SESSION_RANDOM_SOURCE');

export interface Clock {
  now(): Date;
}

export interface RandomSource {
  bytes(size: number): Buffer;
}

export const systemClock: Clock = { now: () => new Date() };
export const cryptographicRandomSource: RandomSource = {
  bytes: (size) => randomBytes(size),
};

export interface CreatedSession {
  rawToken: string;
  expiresAt: Date;
}

export interface AuthenticatedPrincipal {
  sessionId: string;
  user: SafeUser;
}

function digestToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UsersService,
    @Inject(AUTH_CLOCK) private readonly clock: Clock,
    @Inject(SESSION_RANDOM_SOURCE) private readonly random: RandomSource,
  ) {}

  async create(
    userId: string,
    dbSession?: ClientSession,
  ): Promise<CreatedSession> {
    const rawToken = this.random
      .bytes(SESSION_TOKEN_BYTES)
      .toString('base64url');
    const expiresAt = new Date(
      this.clock.now().getTime() + SESSION_LIFETIME_MS,
    );
    await this.sessions.create(
      { userId, tokenDigest: digestToken(rawToken), expiresAt },
      dbSession,
    );
    return { rawToken, expiresAt };
  }

  async resolve(rawToken: string): Promise<AuthenticatedPrincipal | null> {
    const session = await this.sessions.findByTokenDigest(
      digestToken(rawToken),
    );
    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= this.clock.now().getTime()
    ) {
      return null;
    }

    const user = await this.users.findSafeById(session.userId);
    if (user === null || user.status === 'DISABLED') return null;
    return { sessionId: session.id, user };
  }

  async revoke(rawToken: string, dbSession?: ClientSession): Promise<void> {
    await this.sessions.revokeByTokenDigest(
      digestToken(rawToken),
      this.clock.now(),
      dbSession,
    );
  }

  async revokeAllForUser(
    userId: string,
    dbSession?: ClientSession,
  ): Promise<void> {
    await this.sessions.revokeAllForUser(userId, this.clock.now(), dbSession);
  }
}
