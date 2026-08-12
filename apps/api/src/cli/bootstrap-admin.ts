import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { signupSchema, type SafeUser } from '@easygenerator/contracts';
import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AppModule } from '../app.module.js';
import { AdminRepository } from '../modules/admin/admin.repository.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { PasswordService } from '../modules/auth/password.service.js';
import { UsersService } from '../modules/users/users.service.js';

interface BootstrapEnvironment {
  ADMIN_EMAIL?: unknown;
  ADMIN_NAME?: unknown;
  ADMIN_PASSWORD?: unknown;
}

interface BootstrapDependencies {
  users: Pick<UsersService, 'bootstrapConflict' | 'createBootstrapAdmin'>;
  passwords: Pick<PasswordService, 'hash'>;
  audit: Pick<AuditService, 'record'>;
  security: Pick<AdminRepository, 'incrementSecurityRevision'>;
  connection: Pick<Connection, 'transaction'>;
}

interface BootstrapApplicationContext {
  close(): Promise<void>;
  get<T>(token: string | symbol | Type<T>): T;
}

interface BootstrapCliRuntime {
  createApplicationContext(
    module: Type<unknown>,
    options: { abortOnError: false; logger: false },
  ): Promise<BootstrapApplicationContext>;
  environment: BootstrapEnvironment;
  stdout(message: string): void;
  stderr(message: string): void;
}

export class BootstrapAdminError extends Error {
  constructor(public readonly code: 'ADMIN_EXISTS' | 'EMAIL_EXISTS') {
    super(code);
    this.name = 'BootstrapAdminError';
  }
}

export function parseBootstrapAdminEnvironment(
  environment: BootstrapEnvironment,
) {
  return signupSchema.parse({
    email: environment.ADMIN_EMAIL,
    name: environment.ADMIN_NAME,
    password: environment.ADMIN_PASSWORD,
  });
}

export async function bootstrapFirstAdmin(
  environment: BootstrapEnvironment,
  dependencies: BootstrapDependencies,
): Promise<SafeUser> {
  const input = parseBootstrapAdminEnvironment(environment);
  const passwordHash = await dependencies.passwords.hash(input.password);
  return dependencies.connection.transaction(async (dbSession) => {
    await dependencies.security.incrementSecurityRevision(dbSession);
    const conflict = await dependencies.users.bootstrapConflict(
      input.email,
      dbSession,
    );
    if (conflict !== null) throw new BootstrapAdminError(conflict);

    const user = await dependencies.users.createBootstrapAdmin(
      { email: input.email, name: input.name, passwordHash },
      dbSession,
    );
    await dependencies.audit.record(
      {
        action: 'ADMIN_BOOTSTRAPPED',
        actorId: user.id,
        requestId: 'bootstrap-admin-cli',
      },
      dbSession,
    );
    return user;
  });
}

export async function runBootstrapAdminCli(
  runtime: BootstrapCliRuntime,
): Promise<number> {
  let application: BootstrapApplicationContext | undefined;
  let closeAttempted = false;
  try {
    application = await runtime.createApplicationContext(AppModule, {
      abortOnError: false,
      logger: false,
    });
    await bootstrapFirstAdmin(runtime.environment, {
      users: application.get(UsersService),
      passwords: application.get(PasswordService),
      audit: application.get(AuditService),
      security: application.get(AdminRepository),
      connection: application.get<Connection>(getConnectionToken()),
    });
    closeAttempted = true;
    await application.close();
    runtime.stdout('Administrator account created.\n');
    return 0;
  } catch {
    if (application !== undefined && !closeAttempted) {
      try {
        closeAttempted = true;
        await application.close();
      } catch {
        // The single generic CLI failure below covers operation and cleanup.
      }
    }
    runtime.stderr('Administrator bootstrap failed.\n');
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  void runBootstrapAdminCli({
    createApplicationContext: (module, options) =>
      NestFactory.createApplicationContext(module, options),
    environment: process.env,
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
  })
    .then((status) => {
      process.exitCode = status;
    })
    .catch(() => {
      process.exitCode = 1;
      process.stderr.write('Administrator bootstrap failed.\n');
    });
}
