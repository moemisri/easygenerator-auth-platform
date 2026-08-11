import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditController } from '../audit/audit.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { RedisModule } from '../../platform/redis/redis.module';
import { AdminMutationProtectionGuard } from './admin-mutation-protection.guard';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';
import { CapabilityGuard } from './capability.guard';
import {
  SecurityState,
  SecurityStateSchema,
} from './schemas/security-state.schema';

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
