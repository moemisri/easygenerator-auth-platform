import type { Role, UserStatus } from '@easygenerator/contracts';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({
  optimisticConcurrency: true,
  timestamps: true,
  versionKey: 'version',
})
export class User {
  @Prop({ required: true, trim: true, type: String })
  email!: string;

  @Prop({ required: true, type: String })
  emailKey!: string;

  @Prop({ required: true, trim: true, type: String })
  name!: string;

  @Prop({ required: true, select: false, type: String })
  passwordHash!: string;

  @Prop({
    default: 'USER',
    enum: ['USER', 'SUPPORT', 'MANAGER', 'ADMIN'],
    required: true,
    type: String,
  })
  role!: Role;

  @Prop({
    default: 'ACTIVE',
    enum: ['ACTIVE', 'DISABLED'],
    required: true,
    type: String,
  })
  status!: UserStatus;

  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ emailKey: 1 }, { unique: true });
