import { createHmac } from 'node:crypto';

import type {
  SafeUser,
  SigninInput,
  SignupInput,
} from '@easygenerator/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { AppError } from '../../platform/errors/app-error';
import { RateLimiterService } from '../../platform/redis/rate-limiter.service';
import {
  DUMMY_PASSWORD_HASH,
  IDENTITY_HASH_SECRET,
  RateLimitExceededError,
  SIGNIN_IDENTITY_LIMIT,
  SIGNIN_IP_LIMIT,
  SIGNIN_WINDOW_SECONDS,
  SIGNUP_IP_LIMIT,
  SIGNUP_WINDOW_SECONDS,
} from './auth.constants';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

export interface AuthenticationRequestContext {
  ip: string;
  requestId: string;
}

export interface AuthenticationResult {
  user: SafeUser;
  rawSessionToken: string;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11_000
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly rateLimiter: RateLimiterService,
    @InjectConnection() private readonly connection: Connection,
    @Inject(IDENTITY_HASH_SECRET) private readonly identitySecret: Buffer,
    @Inject(DUMMY_PASSWORD_HASH) private readonly dummyPasswordHash: string,
  ) {}

  async signUp(
    input: SignupInput,
    context: AuthenticationRequestContext,
  ): Promise<AuthenticationResult> {
    await this.enforceSignupLimit(context.ip);
    const passwordHash = await this.passwords.hash(input.password);

    try {
      return await this.connection.transaction(async (dbSession) => {
        const user = await this.users.createUser(
          {
            email: input.email,
            name: input.name,
            passwordHash,
            role: 'USER',
            status: 'ACTIVE',
          },
          dbSession,
        );
        const session = await this.sessions.create(user.id, dbSession);
        await this.audit.record(
          {
            action: 'AUTH_SIGNUP_SUCCEEDED',
            actorId: user.id,
            requestId: context.requestId,
          },
          dbSession,
        );
        return { user, rawSessionToken: session.rawToken };
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new AppError('EMAIL_ALREADY_REGISTERED', 409);
      }
      throw error;
    }
  }

  async signIn(
    input: SigninInput,
    context: AuthenticationRequestContext,
  ): Promise<AuthenticationResult> {
    const normalizedIdentity = input.email.trim().toLowerCase();
    const identityDigest = createHmac('sha256', this.identitySecret)
      .update(normalizedIdentity)
      .digest('base64url');
    await this.enforceSigninLimits(context.ip, identityDigest);

    const authenticationUser =
      await this.users.findForAuthentication(normalizedIdentity);
    const passwordHash =
      authenticationUser?.passwordHash ?? this.dummyPasswordHash;
    const passwordValid = await this.passwords.verify(
      passwordHash,
      input.password,
    );
    if (
      authenticationUser === null ||
      !passwordValid ||
      authenticationUser.user.status !== 'ACTIVE'
    ) {
      await this.audit.record({
        action: 'AUTH_SIGNIN_FAILED',
        identityDigest,
        requestId: context.requestId,
      });
      throw new AppError('INVALID_CREDENTIALS', 401);
    }

    return this.connection.transaction(async (dbSession) => {
      const session = await this.sessions.create(
        authenticationUser.user.id,
        dbSession,
      );
      await this.audit.record(
        {
          action: 'AUTH_SIGNIN_SUCCEEDED',
          actorId: authenticationUser.user.id,
          requestId: context.requestId,
        },
        dbSession,
      );
      return {
        user: authenticationUser.user,
        rawSessionToken: session.rawToken,
      };
    });
  }

  async signOut(
    rawSessionToken: string,
    context: AuthenticationRequestContext,
  ): Promise<void> {
    const principal = await this.sessions.resolve(rawSessionToken);
    await this.connection.transaction(async (dbSession) => {
      await this.sessions.revoke(rawSessionToken, dbSession);
      if (principal !== null) {
        await this.audit.record(
          {
            action: 'AUTH_LOGOUT_SUCCEEDED',
            actorId: principal.user.id,
            requestId: context.requestId,
          },
          dbSession,
        );
      }
    });
  }

  private async enforceSignupLimit(ip: string): Promise<void> {
    try {
      const decision = await this.rateLimiter.consume(
        `signup:ip:${ip}`,
        SIGNUP_IP_LIMIT,
        SIGNUP_WINDOW_SECONDS,
      );
      if (!decision.allowed) {
        throw new RateLimitExceededError(decision.retryAfterSeconds);
      }
    } catch (error) {
      if (error instanceof RateLimitExceededError) throw error;
      throw new AppError('AUTH_PROTECTION_UNAVAILABLE', 503);
    }
  }

  private async enforceSigninLimits(
    ip: string,
    identityDigest: string,
  ): Promise<void> {
    try {
      const decisions = await Promise.all([
        this.rateLimiter.consume(
          `signin:ip:${ip}`,
          SIGNIN_IP_LIMIT,
          SIGNIN_WINDOW_SECONDS,
        ),
        this.rateLimiter.consume(
          `signin:identity:${identityDigest}`,
          SIGNIN_IDENTITY_LIMIT,
          SIGNIN_WINDOW_SECONDS,
        ),
      ]);
      const blocked = decisions.filter((decision) => !decision.allowed);
      if (blocked.length > 0) {
        throw new RateLimitExceededError(
          Math.max(...blocked.map((decision) => decision.retryAfterSeconds)),
        );
      }
    } catch (error) {
      if (error instanceof RateLimitExceededError) throw error;
      throw new AppError('AUTH_PROTECTION_UNAVAILABLE', 503);
    }
  }
}
