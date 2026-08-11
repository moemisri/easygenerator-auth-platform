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
  @Prop({ required: true, trim: true })
  email!: string;

  @Prop({ required: true })
  emailKey!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, select: false })
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
