import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type SecurityStateDocument = HydratedDocument<SecurityState>;

@Schema({ timestamps: false, versionKey: false })
export class SecurityState {
  @Prop({ enum: ['authorization'], required: true, type: String, unique: true })
  key!: 'authorization';

  @Prop({ default: 0, min: 0, required: true, type: Number })
  revision!: number;
}

export const SecurityStateSchema = SchemaFactory.createForClass(SecurityState);
