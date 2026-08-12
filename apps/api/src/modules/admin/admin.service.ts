import { setTimeout as delay } from 'node:timers/promises';

import type {
  AdminUsersQuery,
  SafeUser,
  UpdateUserInput,
  UserPage,
} from '@easygenerator/contracts';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';

import { AppError } from '../../platform/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import { UsersService } from '../users/users.service.js';
import { AdminRepository } from './admin.repository.js';
import { canUpdateUser, removesActiveAdmin } from './authorization.policy.js';

const MAX_TRANSACTION_ATTEMPTS = 3;
const MIN_RETRY_DELAY_MS = 5;
const RETRY_JITTER_MS = 10;

export interface AdminRequestContext {
  requestId: string;
}

function hasErrorLabel(error: unknown, label: string): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('hasErrorLabel' in error) ||
    typeof error.hasErrorLabel !== 'function'
  ) {
    return false;
  }
  return error.hasErrorLabel(label) === true;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly adminRepository: AdminRepository,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  listUsers(query: AdminUsersQuery): Promise<UserPage> {
    return this.users.listAdminUsers(query);
  }

  async updateUser(
    principalUser: SafeUser,
    targetId: string,
    input: UpdateUserInput,
    context: AdminRequestContext,
  ): Promise<SafeUser> {
    const dbSession = await this.connection.startSession();
    try {
      for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
        dbSession.startTransaction();
        try {
          const updated = await this.updateInTransaction(
            principalUser.id,
            targetId,
            input,
            context,
            dbSession,
          );
          await this.commitWithRetry(dbSession);
          return updated;
        } catch (error) {
          await this.abortIfActive(dbSession);
          if (!hasErrorLabel(error, 'TransientTransactionError')) throw error;
          if (attempt === MAX_TRANSACTION_ATTEMPTS) {
            throw new AppError('ADMIN_UPDATE_CONFLICT', 409);
          }
          await this.retryDelay();
        }
      }
    } finally {
      await dbSession.endSession();
    }
    throw new AppError('ADMIN_UPDATE_CONFLICT', 409);
  }

  private async commitWithRetry(dbSession: ClientSession): Promise<void> {
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        await dbSession.commitTransaction();
        return;
      } catch (error) {
        if (!hasErrorLabel(error, 'UnknownTransactionCommitResult')) {
          throw error;
        }
        if (attempt === MAX_TRANSACTION_ATTEMPTS) {
          throw new AppError('ADMIN_UPDATE_CONFLICT', 409);
        }
        await this.retryDelay();
      }
    }
  }

  private async abortIfActive(dbSession: ClientSession): Promise<void> {
    if (!dbSession.inTransaction()) return;
    await dbSession.abortTransaction();
  }

  private retryDelay(): Promise<void> {
    return delay(
      MIN_RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_JITTER_MS),
    );
  }

  private async updateInTransaction(
    actorId: string,
    targetId: string,
    input: UpdateUserInput,
    context: AdminRequestContext,
    dbSession: ClientSession,
  ): Promise<SafeUser> {
    await this.adminRepository.incrementSecurityRevision(dbSession);

    const actor = await this.users.findSafeById(actorId, dbSession);
    if (actor === null || actor.status !== 'ACTIVE') {
      throw new AppError('UNAUTHENTICATED', 401);
    }
    const target = await this.users.findSafeById(targetId, dbSession);
    if (target === null) {
      throw new AppError('USER_NOT_FOUND', 404);
    }

    const proposedRole = input.role ?? target.role;
    const proposedStatus = input.status ?? target.status;
    if (!canUpdateUser(actor, target, proposedRole)) {
      throw new AppError('TARGET_UPDATE_FORBIDDEN', 403);
    }
    if (target.version !== input.version) {
      throw new AppError('STALE_USER_VERSION', 409);
    }

    const roleChanged = proposedRole !== target.role;
    const statusChanged = proposedStatus !== target.status;
    if (!roleChanged && !statusChanged) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'The proposed user update does not change the current state.',
      );
    }

    if (
      removesActiveAdmin(target, {
        role: proposedRole,
        status: proposedStatus,
      }) &&
      (await this.users.countActiveAdmins(dbSession)) <= 1
    ) {
      throw new AppError('LAST_ACTIVE_ADMIN_PROTECTED', 409);
    }

    const changes = {
      ...(roleChanged ? { role: proposedRole } : {}),
      ...(statusChanged ? { status: proposedStatus } : {}),
    };
    const updated = await this.users.updateAdminUser(
      target.id,
      input.version,
      changes,
      dbSession,
    );
    if (updated === null) {
      throw new AppError('STALE_USER_VERSION', 409);
    }

    await this.sessions.revokeAllForUser(target.id, dbSession);
    if (roleChanged) {
      await this.audit.record(
        {
          action: 'USER_ROLE_CHANGED',
          actorId: actor.id,
          targetId: target.id,
          from: target.role,
          to: proposedRole,
          requestId: context.requestId,
        },
        dbSession,
      );
    }
    if (statusChanged) {
      await this.audit.record(
        {
          action: 'USER_STATUS_CHANGED',
          actorId: actor.id,
          targetId: target.id,
          from: target.status,
          to: proposedStatus,
          requestId: context.requestId,
        },
        dbSession,
      );
    }
    return updated;
  }
}
