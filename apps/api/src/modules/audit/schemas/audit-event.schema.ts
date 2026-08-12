import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import { SchemaTypes } from 'mongoose';

export const auditActions = [
  'AUTH_SIGNUP_SUCCEEDED',
  'AUTH_SIGNIN_SUCCEEDED',
  'AUTH_SIGNIN_FAILED',
  'AUTH_LOGOUT_SUCCEEDED',
  'SESSION_REJECTED',
  'USER_ROLE_CHANGED',
  'USER_STATUS_CHANGED',
  'ADMIN_BOOTSTRAPPED',
  'ASSISTANT_REFUSED',
] as const;

export type AuditAction = (typeof auditActions)[number];
export type AuditEventDocument = HydratedDocument<AuditEvent>;

/** Audit records are retained for one year, then removed by MongoDB TTL. */
export const AUDIT_RETENTION_SECONDS = 365 * 24 * 60 * 60;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditEvent {
  @Prop({ enum: auditActions, required: true, type: String })
  action!: AuditAction;

  @Prop({ type: String })
  actorId?: string | null;

  @Prop({ type: String })
  targetId?: string;

  @Prop({ required: true, type: String })
  requestId!: string;

  @Prop({ type: SchemaTypes.Mixed })
  metadata?: Record<string, string>;

  createdAt!: Date;
}

export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);
AuditEventSchema.index({ createdAt: -1, _id: -1 });
AuditEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AUDIT_RETENTION_SECONDS },
);
