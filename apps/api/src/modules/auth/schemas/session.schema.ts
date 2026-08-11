import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';
import { SchemaTypes } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

@Schema({ timestamps: true })
export class Session {
  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: 'User' })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  tokenDigest!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: null, type: Date })
  revokedAt!: Date | null;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ tokenDigest: 1 }, { unique: true });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SessionSchema.index({ userId: 1 });
