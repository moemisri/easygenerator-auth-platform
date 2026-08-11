import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditController } from '../audit/audit.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
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
    UsersModule,
  ],
  controllers: [AdminController, AuditController],
  providers: [AdminRepository, AdminService, CapabilityGuard],
  exports: [AdminRepository],
})
export class AdminModule {}
