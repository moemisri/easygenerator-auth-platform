import {
  safeAuditActionSchema,
  safeAuditEventSchema,
  type AdminAuditEventsQuery,
  type AuditEventPage,
  type Role,
  type SafeAuditAction,
  type SafeAuditEvent,
  type UserStatus,
} from '@easygenerator/contracts';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import {
  AuditEvent,
  auditActions,
  type AuditAction,
} from './schemas/audit-event.schema.js';

export type AuditInput =
  | {
      action: 'ADMIN_BOOTSTRAPPED';
      actorId: string;
      requestId: string;
    }
  | {
      action: 'AUTH_SIGNUP_SUCCEEDED';
      actorId: string;
      requestId: string;
    }
  | {
      action: 'AUTH_SIGNIN_SUCCEEDED';
      actorId: string;
      requestId: string;
    }
  | {
      action: 'AUTH_SIGNIN_FAILED';
      identityDigest: string;
      requestId: string;
    }
  | {
      action: 'AUTH_LOGOUT_SUCCEEDED';
      actorId: string;
      requestId: string;
    }
  | {
      action: 'SESSION_REJECTED';
      actorId: string | null;
      reason: 'EXPIRED' | 'REVOKED' | 'DISABLED';
      requestId: string;
    }
  | {
      action: 'USER_ROLE_CHANGED';
      actorId: string;
      targetId: string;
      from: Role;
      to: Role;
      requestId: string;
    }
  | {
      action: 'USER_STATUS_CHANGED';
      actorId: string;
      targetId: string;
      from: UserStatus;
      to: UserStatus;
      requestId: string;
    }
  | {
      action: 'ASSISTANT_REFUSED';
      actorId: string;
      reason: 'INSUFFICIENT_DOCUMENTATION' | 'RATE_LIMITED';
      requestId: string;
    };

interface AuditWrite {
  action: AuditAction;
  requestId: string;
  actorId?: string | null;
  targetId?: string;
  metadata?: Record<string, string>;
}

function toAuditWrite(input: AuditInput): AuditWrite {
  switch (input.action) {
    case 'AUTH_SIGNUP_SUCCEEDED':
    case 'AUTH_SIGNIN_SUCCEEDED':
    case 'AUTH_LOGOUT_SUCCEEDED':
    case 'ADMIN_BOOTSTRAPPED':
      return {
        action: input.action,
        actorId: input.actorId,
        requestId: input.requestId,
      };
    case 'AUTH_SIGNIN_FAILED':
      return {
        action: input.action,
        requestId: input.requestId,
        metadata: { identityDigest: input.identityDigest },
      };
    case 'SESSION_REJECTED':
      return {
        action: input.action,
        actorId: input.actorId,
        requestId: input.requestId,
        metadata: { reason: input.reason },
      };
    case 'USER_ROLE_CHANGED':
    case 'USER_STATUS_CHANGED':
      return {
        action: input.action,
        actorId: input.actorId,
        targetId: input.targetId,
        requestId: input.requestId,
        metadata: { from: input.from, to: input.to },
      };
    case 'ASSISTANT_REFUSED':
      return {
        action: input.action,
        actorId: input.actorId,
        requestId: input.requestId,
        metadata: { reason: input.reason },
      };
  }
}

interface AuditRecord {
  _id: unknown;
  action: unknown;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const knownRoles = new Set(['USER', 'SUPPORT', 'MANAGER', 'ADMIN']);
const knownStatuses = new Set(['ACTIVE', 'DISABLED']);

function summaryFor(
  action: SafeAuditAction,
  metadata?: Record<string, unknown>,
): string {
  switch (action) {
    case 'AUTH_SIGNUP_SUCCEEDED':
      return 'A user account was created.';
    case 'AUTH_SIGNIN_SUCCEEDED':
      return 'A user signed in.';
    case 'AUTH_SIGNIN_FAILED':
      return 'A sign-in attempt was rejected.';
    case 'AUTH_LOGOUT_SUCCEEDED':
      return 'A user signed out.';
    case 'SESSION_REJECTED':
      return 'A session was rejected.';
    case 'USER_ROLE_CHANGED': {
      const from = metadata?.from;
      const to = metadata?.to;
      return typeof from === 'string' &&
        typeof to === 'string' &&
        knownRoles.has(from) &&
        knownRoles.has(to)
        ? `A user role changed from ${from} to ${to}.`
        : 'A user role changed.';
    }
    case 'USER_STATUS_CHANGED': {
      const from = metadata?.from;
      const to = metadata?.to;
      return typeof from === 'string' &&
        typeof to === 'string' &&
        knownStatuses.has(from) &&
        knownStatuses.has(to)
        ? `A user status changed from ${from} to ${to}.`
        : 'A user status changed.';
    }
    case 'ADMIN_BOOTSTRAPPED':
      return 'The first administrator account was created.';
    case 'ASSISTANT_REFUSED':
      return 'An assistant request was refused.';
  }
}

function mapSafeAuditEvent(record: AuditRecord): SafeAuditEvent | null {
  const action = safeAuditActionSchema.safeParse(record.action);
  if (!action.success) return null;
  return safeAuditEventSchema.parse({
    id: String(record._id),
    action: action.data,
    occurredAt: record.createdAt.toISOString(),
    summary: summaryFor(action.data, record.metadata),
  });
}

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditEvent.name)
    private readonly auditEvents: Model<AuditEvent>,
  ) {}

  async record(input: AuditInput, dbSession?: ClientSession): Promise<void> {
    const write = toAuditWrite(input);
    if (dbSession === undefined) {
      await this.auditEvents.create(write);
      return;
    }
    await this.auditEvents.create([write], { session: dbSession });
  }

  async listSafe(query: AdminAuditEventsQuery): Promise<AuditEventPage> {
    const filter = { action: { $in: auditActions } };
    const [records, total] = await Promise.all([
      this.auditEvents
        .find(filter)
        .select('_id action metadata createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<AuditRecord[]>()
        .exec(),
      this.auditEvents.countDocuments(filter).exec(),
    ]);
    return {
      items: records.flatMap((record) => {
        const event = mapSafeAuditEvent(record);
        return event === null ? [] : [event];
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}
