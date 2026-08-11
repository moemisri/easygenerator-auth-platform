import type { Role, UserStatus } from '@easygenerator/contracts';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuditEvent, type AuditAction } from './schemas/audit-event.schema';

export type AuditInput =
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

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditEvent.name)
    private readonly auditEvents: Model<AuditEvent>,
  ) {}

  async record(input: AuditInput): Promise<void> {
    await this.auditEvents.create(toAuditWrite(input));
  }
}
