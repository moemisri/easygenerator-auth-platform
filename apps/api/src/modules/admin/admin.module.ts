import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditController } from '../audit/audit.controller.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from '../users/users.module.js';
import { RedisModule } from '../../platform/redis/redis.module.js';
import { AdminMutationProtectionGuard } from './admin-mutation-protection.guard.js';
import { AdminController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';
import { CapabilityGuard } from './capability.guard.js';
import {
  SecurityState,
  SecurityStateSchema,
} from './schemas/security-state.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SecurityState.name, schema: SecurityStateSchema },
    ]),
    AuditModule,
    AuthModule,
    RedisModule,
    UsersModule,
  ],
  controllers: [AdminController, AuditController],
  providers: [
    AdminMutationProtectionGuard,
    AdminRepository,
    AdminService,
    CapabilityGuard,
  ],
  exports: [AdminRepository],
})
export class AdminModule {}
