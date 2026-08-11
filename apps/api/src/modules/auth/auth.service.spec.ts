import type {
  SafeUser,
  SigninInput,
  SignupInput,
} from '@easygenerator/contracts';
import type { Connection } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../audit/audit.service';
import type { UsersService } from '../users/users.service';
import { AppError } from '../../platform/errors/app-error';
import { PrivacyKeyDigestService } from '../../platform/redis/privacy-key-digest.service';
import type { RateLimiterService } from '../../platform/redis/rate-limiter.service';
import type { PasswordService } from './password.service';
import type { SessionService } from './session.service';
import { AuthService, type AuthenticationRequestContext } from './auth.service';

const identitySecret = Buffer.alloc(32, 9);
const signupIpDigest = 'FbRIrznX68k2qY-ocRmyCRkVhdw3Qsx6D0UXOp3lDOA';
const signinIpDigest = 'c2KtNdMi893CBP4MzYinuJnd9p6u0wm5AEXE2LekFuA';
const signinIdentityDigest = 'uNzE4Ep4JhKKAtCv-abxBufK6LdFOkc9pOG8Xt0HWVo';
const dummyPasswordHash = 'process-held-dummy-hash';
const transactionSession = { id: 'transaction-session' };
const requestContext: AuthenticationRequestContext = {
  ip: '203.0.113.42',
  requestId: 'request-123',
};
const signupInput: SignupInput = {
  email: ' Ada@Example.com ',
  name: 'Ada Lovelace',
  password: 'Secure1!',
};
const signinInput: SigninInput = {
  email: ' Ada@Example.com ',
  password: 'Secure1!',
};
const activeUser: SafeUser = {
  id: '507f1f77bcf86cd799439011',
  email: 'Ada@Example.com',
  name: 'Ada Lovelace',
  role: 'USER',
  status: 'ACTIVE',
  version: 0,
  createdAt: '2026-08-11T10:00:00.000Z',
  updatedAt: '2026-08-11T10:00:00.000Z',
};

describe('AuthService', () => {
  let users: {
    createUser: ReturnType<typeof vi.fn>;
    findForAuthentication: ReturnType<typeof vi.fn>;
  };
  let passwords: {
    hash: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };
  let sessions: {
    create: ReturnType<typeof vi.fn>;
    resolve: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
  let audit: { record: ReturnType<typeof vi.fn> };
  let rateLimiter: { consume: ReturnType<typeof vi.fn> };
  let privacyKeys: { digest: ReturnType<typeof vi.fn> };
  let connection: { transaction: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    users = {
      createUser: vi.fn().mockResolvedValue(activeUser),
      findForAuthentication: vi.fn().mockResolvedValue({
        user: activeUser,
        passwordHash: 'stored-password-hash',
      }),
    };
    passwords = {
      hash: vi.fn().mockResolvedValue('new-password-hash'),
      verify: vi.fn().mockResolvedValue(true),
    };
    sessions = {
      create: vi.fn().mockResolvedValue({
        rawToken: 'new-raw-session-token',
        expiresAt: new Date('2026-08-18T10:00:00.000Z'),
      }),
      resolve: vi.fn().mockResolvedValue({
        sessionId: 'session-id',
        user: activeUser,
      }),
      revoke: vi.fn().mockResolvedValue(undefined),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    rateLimiter = {
      consume: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 4,
        retryAfterSeconds: 0,
      }),
    };
    const realPrivacyKeys = new PrivacyKeyDigestService({
      getOrThrow: (key: string) => {
        if (key === 'IDENTITY_HASH_SECRET') {
          return identitySecret.toString('base64');
        }
        throw new Error(`Unexpected config key: ${key}`);
      },
    } as never);
    privacyKeys = {
      digest: vi.fn(realPrivacyKeys.digest.bind(realPrivacyKeys)),
    };
    connection = {
      transaction: vi.fn(async (work: (session: unknown) => unknown) =>
        work(transactionSession),
      ),
    };
    service = new AuthService(
      users as unknown as UsersService,
      passwords as unknown as PasswordService,
      sessions as unknown as SessionService,
      audit as unknown as AuditService,
      rateLimiter as unknown as RateLimiterService,
      privacyKeys as unknown as PrivacyKeyDigestService,
      connection as unknown as Connection,
      dummyPasswordHash,
    );
  });

  it('creates only an ACTIVE USER and returns a fresh safe session', async () => {
    const result = await service.signUp(signupInput, requestContext);

    expect(passwords.hash).toHaveBeenCalledWith('Secure1!');
    expect(users.createUser).toHaveBeenCalledWith(
      {
        email: ' Ada@Example.com ',
        name: 'Ada Lovelace',
        passwordHash: 'new-password-hash',
        role: 'USER',
        status: 'ACTIVE',
      },
      transactionSession,
    );
    expect(sessions.create).toHaveBeenCalledWith(
      activeUser.id,
      transactionSession,
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'AUTH_SIGNUP_SUCCEEDED',
        actorId: activeUser.id,
        requestId: 'request-123',
      },
      transactionSession,
    );
    expect(result).toEqual({
      user: activeUser,
      rawSessionToken: 'new-raw-session-token',
    });
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('limits signup by trusted IP before hashing the password', async () => {
    rateLimiter.consume.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 321,
    });

    await expect(
      service.signUp(signupInput, requestContext),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 321,
    });
    expect(rateLimiter.consume).toHaveBeenCalledWith(
      `auth:signup:ip:${signupIpDigest}`,
      5,
      3600,
    );
    expect(privacyKeys.digest).toHaveBeenCalledWith(
      'auth:signup:ip',
      '203.0.113.42',
    );
    expect(JSON.stringify(rateLimiter.consume.mock.calls)).not.toContain(
      '203.0.113.42',
    );
    expect(passwords.hash).not.toHaveBeenCalled();
  });

  it('fails signup closed when Redis protection is unavailable', async () => {
    rateLimiter.consume.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.signUp(signupInput, requestContext)).rejects.toEqual(
      expect.objectContaining({
        code: 'AUTH_PROTECTION_UNAVAILABLE',
        status: 503,
      }),
    );
    expect(passwords.hash).not.toHaveBeenCalled();
  });

  it('fails signup closed without Redis access when IP digesting fails', async () => {
    privacyKeys.digest.mockImplementation(() => {
      throw new Error('digest unavailable');
    });

    await expect(service.signUp(signupInput, requestContext)).rejects.toEqual(
      expect.objectContaining({
        code: 'AUTH_PROTECTION_UNAVAILABLE',
        status: 503,
      }),
    );
    expect(rateLimiter.consume).not.toHaveBeenCalled();
    expect(passwords.hash).not.toHaveBeenCalled();
  });

  it('maps duplicate-key signup races to the stable conflict', async () => {
    users.createUser.mockRejectedValue({
      code: 11_000,
      keyValue: { emailKey: 'ada@example.com' },
    });

    await expect(service.signUp(signupInput, requestContext)).rejects.toEqual(
      expect.objectContaining({
        code: 'EMAIL_ALREADY_REGISTERED',
        status: 409,
      }),
    );
  });

  it('creates a fresh session and allowlisted audit event after signin', async () => {
    const result = await service.signIn(signinInput, requestContext);

    expect(users.findForAuthentication).toHaveBeenCalledWith('ada@example.com');
    expect(passwords.verify).toHaveBeenCalledWith(
      'stored-password-hash',
      'Secure1!',
    );
    expect(sessions.create).toHaveBeenCalledWith(
      activeUser.id,
      transactionSession,
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'AUTH_SIGNIN_SUCCEEDED',
        actorId: activeUser.id,
        requestId: 'request-123',
      },
      transactionSession,
    );
    expect(result).toEqual({
      user: activeUser,
      rawSessionToken: 'new-raw-session-token',
    });
  });

  it.each([
    {
      name: 'unknown user',
      authenticationResult: null,
      passwordValid: false,
      expectedHash: dummyPasswordHash,
    },
    {
      name: 'wrong password',
      authenticationResult: {
        user: activeUser,
        passwordHash: 'stored-password-hash',
      },
      passwordValid: false,
      expectedHash: 'stored-password-hash',
    },
    {
      name: 'disabled user',
      authenticationResult: {
        user: { ...activeUser, status: 'DISABLED' as const },
        passwordHash: 'disabled-password-hash',
      },
      passwordValid: true,
      expectedHash: 'disabled-password-hash',
    },
  ])(
    'returns the same credential error for $name after password verification',
    async ({ authenticationResult, passwordValid, expectedHash }) => {
      users.findForAuthentication.mockResolvedValue(authenticationResult);
      passwords.verify.mockResolvedValue(passwordValid);

      await expect(service.signIn(signinInput, requestContext)).rejects.toEqual(
        expect.objectContaining({
          code: 'INVALID_CREDENTIALS',
          status: 401,
        }),
      );
      expect(passwords.verify).toHaveBeenCalledWith(expectedHash, 'Secure1!');
      expect(sessions.create).not.toHaveBeenCalled();
    },
  );

  it('reuses one process-held dummy hash across missing-user attempts', async () => {
    users.findForAuthentication.mockResolvedValue(null);
    passwords.verify.mockResolvedValue(false);

    await service.signIn(signinInput, requestContext).catch(() => undefined);
    await service.signIn(signinInput, requestContext).catch(() => undefined);

    expect(passwords.verify).toHaveBeenNthCalledWith(
      1,
      dummyPasswordHash,
      'Secure1!',
    );
    expect(passwords.verify).toHaveBeenNthCalledWith(
      2,
      dummyPasswordHash,
      'Secure1!',
    );
  });

  it('rate-limits signin by IP and HMAC email digest without exposing the identity', async () => {
    await service.signIn(signinInput, requestContext);

    expect(rateLimiter.consume).toHaveBeenNthCalledWith(
      1,
      `auth:signin:ip:${signinIpDigest}`,
      10,
      900,
    );
    expect(rateLimiter.consume).toHaveBeenNthCalledWith(
      2,
      `auth:signin:identity:${signinIdentityDigest}`,
      5,
      900,
    );
    expect(privacyKeys.digest.mock.calls).toEqual([
      ['auth:signin:ip', '203.0.113.42'],
      ['auth:signin:identity', 'ada@example.com'],
    ]);
    expect(JSON.stringify(rateLimiter.consume.mock.calls)).not.toContain(
      'Ada@Example.com',
    );
    expect(JSON.stringify(rateLimiter.consume.mock.calls)).not.toContain(
      'ada@example.com',
    );
    expect(JSON.stringify(rateLimiter.consume.mock.calls)).not.toContain(
      '203.0.113.42',
    );
  });

  it('audits failed signin with only the HMAC identity digest', async () => {
    users.findForAuthentication.mockResolvedValue(null);
    passwords.verify.mockResolvedValue(false);
    await expect(
      service.signIn(signinInput, requestContext),
    ).rejects.toBeInstanceOf(AppError);

    expect(audit.record).toHaveBeenCalledWith({
      action: 'AUTH_SIGNIN_FAILED',
      identityDigest: signinIdentityDigest,
      requestId: 'request-123',
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      'Ada@Example.com',
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('Secure1!');
  });

  it('uses the longest blocked signin window and does no password work', async () => {
    rateLimiter.consume
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 120,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 240,
      });

    await expect(
      service.signIn(signinInput, requestContext),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 240,
    });
    expect(users.findForAuthentication).not.toHaveBeenCalled();
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('fails signin closed when either Redis limit is unavailable', async () => {
    rateLimiter.consume
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 9,
        retryAfterSeconds: 0,
      })
      .mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(service.signIn(signinInput, requestContext)).rejects.toEqual(
      expect.objectContaining({
        code: 'AUTH_PROTECTION_UNAVAILABLE',
        status: 503,
      }),
    );
    expect(users.findForAuthentication).not.toHaveBeenCalled();
  });

  it('fails signin closed without Redis access when either digest fails', async () => {
    privacyKeys.digest.mockImplementation((scope: string) => {
      if (scope === 'auth:signin:identity') {
        throw new Error('digest unavailable');
      }
      return signinIpDigest;
    });

    await expect(service.signIn(signinInput, requestContext)).rejects.toEqual(
      expect.objectContaining({
        code: 'AUTH_PROTECTION_UNAVAILABLE',
        status: 503,
      }),
    );
    expect(rateLimiter.consume).not.toHaveBeenCalled();
    expect(users.findForAuthentication).not.toHaveBeenCalled();
  });

  it('revokes logout idempotently and audits only a currently resolved actor', async () => {
    await service.signOut('raw-session-token', requestContext);
    sessions.resolve.mockResolvedValueOnce(null);
    await service.signOut('raw-session-token', requestContext);

    expect(sessions.revoke).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'AUTH_LOGOUT_SUCCEEDED',
        actorId: activeUser.id,
        requestId: 'request-123',
      },
      transactionSession,
    );
  });
});
