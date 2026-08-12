import type { ClientSession, Connection } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapFirstAdmin,
  parseBootstrapAdminEnvironment,
  runBootstrapAdminCli,
} from './bootstrap-admin';

const validEnvironment = {
  ADMIN_EMAIL: ' admin@example.com ',
  ADMIN_NAME: 'Administrator',
  ADMIN_PASSWORD: 'Secure1!',
};

describe('bootstrap admin entrypoint', () => {
  it('is import-safe and does not require CLI environment during import', async () => {
    await expect(import('./bootstrap-admin')).resolves.toMatchObject({
      bootstrapFirstAdmin: expect.any(Function),
      parseBootstrapAdminEnvironment: expect.any(Function),
    });
  });

  it('requires all three variables and validates with signup boundaries', () => {
    expect(parseBootstrapAdminEnvironment(validEnvironment)).toEqual({
      email: 'admin@example.com',
      name: 'Administrator',
      password: 'Secure1!',
    });
    expect(() =>
      parseBootstrapAdminEnvironment({
        ADMIN_NAME: 'Administrator',
        ADMIN_PASSWORD: 'Secure1!',
      }),
    ).toThrow();
    expect(() =>
      parseBootstrapAdminEnvironment({
        ...validEnvironment,
        ADMIN_EMAIL: 'not-an-email',
      }),
    ).toThrow();
    expect(() =>
      parseBootstrapAdminEnvironment({
        ...validEnvironment,
        ADMIN_NAME: 'Al',
      }),
    ).toThrow();
    expect(() =>
      parseBootstrapAdminEnvironment({
        ...validEnvironment,
        ADMIN_PASSWORD: 'weak',
      }),
    ).toThrow();
  });

  it('serializes existence checks and creates exactly an ACTIVE ADMIN with a safe audit', async () => {
    const sequence: string[] = [];
    const dbSession = { id: 'transaction' } as unknown as ClientSession;
    const users = {
      bootstrapConflict: vi.fn(async () => {
        sequence.push('check');
        return null;
      }),
      createBootstrapAdmin: vi.fn(async () => {
        sequence.push('create');
        return {
          id: 'admin-id',
          email: 'admin@example.com',
          name: 'Administrator',
          role: 'ADMIN' as const,
          status: 'ACTIVE' as const,
          version: 0,
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
        };
      }),
    };
    const passwords = {
      hash: vi.fn().mockResolvedValue('argon2-hash'),
    };
    const audit = {
      record: vi.fn(async () => {
        sequence.push('audit');
      }),
    };
    const security = {
      incrementSecurityRevision: vi.fn(async () => {
        sequence.push('security');
      }),
    };
    const connection = {
      transaction: vi.fn(
        async <T>(work: (session: ClientSession) => Promise<T>): Promise<T> =>
          work(dbSession),
      ),
    };

    await bootstrapFirstAdmin(validEnvironment, {
      users,
      passwords,
      audit,
      security,
      connection: connection as unknown as Connection,
    });

    expect(sequence).toEqual(['security', 'check', 'create', 'audit']);
    expect(users.bootstrapConflict).toHaveBeenCalledWith(
      'admin@example.com',
      dbSession,
    );
    expect(users.createBootstrapAdmin).toHaveBeenCalledWith(
      {
        email: 'admin@example.com',
        name: 'Administrator',
        passwordHash: 'argon2-hash',
      },
      dbSession,
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'ADMIN_BOOTSTRAPPED',
        actorId: 'admin-id',
        requestId: 'bootstrap-admin-cli',
      },
      dbSession,
    );
  });

  it.each(['ADMIN_EXISTS', 'EMAIL_EXISTS'] as const)(
    'refuses bootstrap conflict %s before creating a user',
    async (conflict) => {
      const users = {
        bootstrapConflict: vi.fn().mockResolvedValue(conflict),
        createBootstrapAdmin: vi.fn(),
      };
      const dependencies = {
        users,
        passwords: { hash: vi.fn().mockResolvedValue('argon2-hash') },
        audit: { record: vi.fn() },
        security: {
          incrementSecurityRevision: vi.fn().mockResolvedValue(undefined),
        },
        connection: {
          transaction: async <T>(
            work: (session: ClientSession) => Promise<T>,
          ): Promise<T> => work({} as ClientSession),
        } as unknown as Connection,
      };

      await expect(
        bootstrapFirstAdmin(validEnvironment, dependencies),
      ).rejects.toMatchObject({ code: conflict });
      expect(users.createBootstrapAdmin).not.toHaveBeenCalled();
      expect(dependencies.audit.record).not.toHaveBeenCalled();
    },
  );

  it('sanitizes application-context initialization failures and disables Nest aborts', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const createApplicationContext = vi
      .fn()
      .mockRejectedValue(
        new Error(
          ['mongodb://admin', ':secret-password@', 'database.example'].join(''),
        ),
      );

    await expect(
      runBootstrapAdminCli({
        createApplicationContext,
        environment: validEnvironment,
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(1);

    expect(createApplicationContext).toHaveBeenCalledWith(
      expect.any(Function),
      { abortOnError: false, logger: false },
    );
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['Administrator bootstrap failed.\n']);
    expect(JSON.stringify({ stdout, stderr })).not.toContain('secret-password');
    expect(JSON.stringify({ stdout, stderr })).not.toContain('mongodb://');
  });

  it('sanitizes context cleanup failures and returns nonzero without success output', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const dbSession = {} as ClientSession;
    const dependencies = {
      users: {
        bootstrapConflict: vi.fn().mockResolvedValue(null),
        createBootstrapAdmin: vi.fn().mockResolvedValue({
          id: 'admin-id',
          email: 'admin@example.com',
          name: 'Administrator',
          role: 'ADMIN',
          status: 'ACTIVE',
          version: 0,
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
        }),
      },
      passwords: { hash: vi.fn().mockResolvedValue('argon2-hash') },
      audit: { record: vi.fn().mockResolvedValue(undefined) },
      security: {
        incrementSecurityRevision: vi.fn().mockResolvedValue(undefined),
      },
      connection: {
        transaction: async <T>(
          work: (session: ClientSession) => Promise<T>,
        ): Promise<T> => work(dbSession),
      },
    };
    const close = vi
      .fn()
      .mockRejectedValue(new Error('ADMIN_PASSWORD=secret-marker'));
    const application = {
      close,
      get: (token: unknown) => {
        const values = Object.values(dependencies);
        const byName =
          typeof token === 'function' && 'name' in token ? token.name : '';
        if (byName === 'UsersService') return dependencies.users;
        if (byName === 'PasswordService') return dependencies.passwords;
        if (byName === 'AuditService') return dependencies.audit;
        if (byName === 'AdminRepository') return dependencies.security;
        return values.at(-1);
      },
    };

    await expect(
      runBootstrapAdminCli({
        createApplicationContext: vi.fn().mockResolvedValue(application),
        environment: validEnvironment,
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(1);

    expect(close).toHaveBeenCalledOnce();
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['Administrator bootstrap failed.\n']);
    expect(JSON.stringify({ stdout, stderr })).not.toContain('secret-marker');
    expect(JSON.stringify({ stdout, stderr })).not.toContain('ADMIN_PASSWORD');
  });
});
