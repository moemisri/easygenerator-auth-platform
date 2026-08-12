import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditEvent, AuditEventSchema } from './schemas/audit-event.schema.js';
import { AuditService } from './audit.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
