import { createHash, randomBytes } from 'node:crypto';

import type { SafeUser } from '@easygenerator/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientSession } from 'mongoose';

import { UsersService } from '../users/users.service.js';
import { SessionRepository } from './session.repository.js';

const SESSION_TOKEN_BYTES = 32;

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

export type SessionRejectionReason = 'EXPIRED' | 'REVOKED' | 'DISABLED';

export type SessionResolution =
  | { principal: AuthenticatedPrincipal; rejection: null }
  | {
      principal: null;
      rejection: { actorId: string; reason: SessionRejectionReason } | null;
    };

function digestToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class SessionService {
  private readonly sessionLifetimeMilliseconds: number;

  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UsersService,
    @Inject(AUTH_CLOCK) private readonly clock: Clock,
    @Inject(SESSION_RANDOM_SOURCE) private readonly random: RandomSource,
    config: ConfigService,
  ) {
    this.sessionLifetimeMilliseconds =
      config.getOrThrow<number>('SESSION_TTL_SECONDS') * 1_000;
  }

  async create(
    userId: string,
    dbSession?: ClientSession,
  ): Promise<CreatedSession> {
    const rawToken = this.random
      .bytes(SESSION_TOKEN_BYTES)
      .toString('base64url');
    const expiresAt = new Date(
      this.clock.now().getTime() + this.sessionLifetimeMilliseconds,
    );
    await this.sessions.create(
      { userId, tokenDigest: digestToken(rawToken), expiresAt },
      dbSession,
    );
    return { rawToken, expiresAt };
  }

  async resolve(rawToken: string): Promise<AuthenticatedPrincipal | null> {
    return (await this.resolveDetailed(rawToken)).principal;
  }

  async resolveDetailed(rawToken: string): Promise<SessionResolution> {
    const session = await this.sessions.findByTokenDigest(
      digestToken(rawToken),
    );
    if (session === null) return { principal: null, rejection: null };
    if (session.revokedAt !== null) {
      return {
        principal: null,
        rejection: { actorId: session.userId, reason: 'REVOKED' },
      };
    }
    if (session.expiresAt.getTime() <= this.clock.now().getTime()) {
      return {
        principal: null,
        rejection: { actorId: session.userId, reason: 'EXPIRED' },
      };
    }

    const user = await this.users.findSafeById(session.userId);
    if (user === null) return { principal: null, rejection: null };
    if (user.status !== 'ACTIVE') {
      return {
        principal: null,
        rejection: { actorId: user.id, reason: 'DISABLED' },
      };
    }
    return {
      principal: { sessionId: session.id, user },
      rejection: null,
    };
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
