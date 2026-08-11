import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';

import { SecurityState } from './schemas/security-state.schema';

@Injectable()
export class AdminRepository {
  constructor(
    @InjectModel(SecurityState.name)
    private readonly securityState: Model<SecurityState>,
  ) {}

  async incrementSecurityRevision(dbSession: ClientSession): Promise<void> {
    await this.securityState
      .findOneAndUpdate(
        { key: 'authorization' },
        {
          $inc: { revision: 1 },
          $setOnInsert: { key: 'authorization' },
        },
        { session: dbSession, upsert: true },
      )
      .exec();
  }
}
